from __future__ import annotations

import argparse
import json
import os
import statistics
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import psutil

from .ground_truth import write_ground_truth
from .models import PixelBox
from .ocr import PaddleOcrEngine
from .pipeline import recognize_image
from .synthetic import generate_synthetic_sample

CACHE_CANDIDATES = (
    Path.home() / ".paddlex",
    Path.home() / ".paddleocr",
    Path(os.environ.get("LOCALAPPDATA", "")) / "paddlex",
)


def _directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def _cache_snapshot() -> dict[str, Any]:
    roots = []
    total = 0
    for path in CACHE_CANDIDATES:
        if not str(path) or not path.exists():
            continue
        size = _directory_size(path)
        total += size
        entries = []
        try:
            children = sorted(path.iterdir())
        except OSError:
            children = []
        for child in children:
            if child.is_dir():
                entries.append({"name": child.name, "bytes": _directory_size(child)})
        roots.append({"path": str(path), "bytes": size, "entries": entries})
    return {"bytes": total, "roots": roots}


class CacheWriteSampler:
    def __init__(self) -> None:
        self.first_change: float | None = None
        self.last_change: float | None = None
        self.initial_bytes = _cache_snapshot()["bytes"]
        self.last_bytes = self.initial_bytes
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(0.1):
            current = _cache_snapshot()["bytes"]
            if current != self.last_bytes:
                now = time.perf_counter()
                if self.first_change is None:
                    self.first_change = now
                self.last_change = now
                self.last_bytes = current

    def __enter__(self) -> "CacheWriteSampler":
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        current = _cache_snapshot()["bytes"]
        if current != self.last_bytes:
            now = time.perf_counter()
            if self.first_change is None:
                self.first_change = now
            self.last_change = now
            self.last_bytes = current

    @property
    def download_seconds(self) -> float | None:
        if self.first_change is None or self.last_change is None:
            return None
        return max(0.0, self.last_change - self.first_change)


class MemorySampler:
    def __init__(self) -> None:
        self.process = psutil.Process()
        self.peak = self.process.memory_info().rss
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(0.02):
            self.peak = max(self.peak, self.process.memory_info().rss)

    def __enter__(self) -> "MemorySampler":
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        self.peak = max(self.peak, self.process.memory_info().rss)

    @property
    def peak_mb(self) -> float:
        return round(self.peak / 1024 / 1024, 3)


def _shape(value: Any) -> dict[str, Any]:
    if isinstance(value, np.ndarray):
        return {
            "type": f"{type(value).__module__}.{type(value).__name__}",
            "shape": list(value.shape),
            "dtype": str(value.dtype),
        }
    if isinstance(value, (list, tuple)):
        return {
            "type": f"{type(value).__module__}.{type(value).__name__}",
            "length": len(value),
        }
    if value is None:
        return {"type": "NoneType"}
    return {"type": f"{type(value).__module__}.{type(value).__name__}"}


def _payload_without_text(result: Any) -> dict[str, Any] | None:
    if isinstance(result, dict):
        payload = result
    else:
        value = getattr(result, "json", None)
        if callable(value):
            try:
                value = value()
            except Exception:
                value = None
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = None
        if isinstance(value, dict):
            payload = value
        else:
            to_dict = getattr(result, "to_dict", None)
            if callable(to_dict):
                try:
                    value = to_dict()
                except Exception:
                    value = None
            payload = value if isinstance(value, dict) else None
    if isinstance(payload, dict) and isinstance(payload.get("res"), dict):
        return payload["res"]
    return payload if isinstance(payload, dict) else None


def summarize_prediction_structure(prediction: Any) -> dict[str, Any]:
    container_type = f"{type(prediction).__module__}.{type(prediction).__name__}"
    if isinstance(prediction, (dict, str, bytes, bytearray)):
        items = [prediction]
    else:
        try:
            items = list(prediction)
        except TypeError:
            items = [prediction]
    summaries = []
    for item in items:
        public_names = sorted(name for name in dir(item) if not name.startswith("_"))
        json_attr = getattr(item, "json", None)
        payload = _payload_without_text(item)
        summaries.append(
            {
                "type": f"{type(item).__module__}.{type(item).__name__}",
                "publicAttributesAndMethods": public_names,
                "json": {
                    "present": hasattr(item, "json"),
                    "callable": callable(json_attr),
                    "attributeType": (
                        f"{type(json_attr).__module__}.{type(json_attr).__name__}"
                        if json_attr is not None
                        else None
                    ),
                },
                "toDictCallable": callable(getattr(item, "to_dict", None)),
                "fields": {
                    key: _shape(payload.get(key) if payload else None)
                    for key in (
                        "rec_texts",
                        "rec_scores",
                        "rec_boxes",
                        "rec_polys",
                        "dt_polys",
                    )
                },
                "payloadKeys": sorted(payload.keys()) if payload else [],
            }
        )
    return {
        "predictionType": f"{type(prediction).__module__}.{type(prediction).__name__}",
        "topLevelContainerType": container_type,
        "itemCount": len(items),
        "items": summaries,
    }


def _patch_report(path: Path, **values: Any) -> dict[str, Any]:
    report = json.loads(path.read_text(encoding="utf-8"))
    report.update(values)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def _offline_cache_test(image_path: Path) -> dict[str, Any]:
    proxy_keys = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY")
    saved = {key: os.environ.get(key) for key in proxy_keys}
    try:
        for key in proxy_keys:
            os.environ[key] = "http://127.0.0.1:9"
        os.environ["HF_HUB_OFFLINE"] = "1"
        started = time.perf_counter()
        engine = PaddleOcrEngine()
        initialization = time.perf_counter() - started
        image = cv2.imread(str(image_path))
        tokens = engine.recognize(
            image,
            PixelBox(0.0, 0.0, float(image.shape[1]), float(image.shape[0])),
        )
        return {
            "success": True,
            "initializationSeconds": initialization,
            "tokenCount": len(tokens),
            "networkProxy": "127.0.0.1:9",
        }
    except Exception as error:
        return {
            "success": False,
            "error": f"{type(error).__name__}: {error}",
            "networkProxy": "127.0.0.1:9",
        }
    finally:
        os.environ.pop("HF_HUB_OFFLINE", None)
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _aggregate(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for run in runs:
        groups.setdefault((run["sample"], run["ocrMode"]), []).append(run)
    result = []
    for (sample, mode), values in sorted(groups.items()):
        cold = next(item for item in values if item["temperature"] == "cold")
        hot = [item for item in values if item["temperature"] == "hot"]
        hot_inference = [item["totalInferenceSeconds"] for item in hot]
        result.append(
            {
                "sample": sample,
                "ocrMode": mode,
                "predictCallCount": cold["predictCallCount"],
                "coldInferenceSeconds": cold["totalInferenceSeconds"],
                "hotInferenceSeconds": hot_inference,
                "averageHotInferenceSeconds": statistics.fmean(hot_inference),
                "maximumHotInferenceSeconds": max(hot_inference),
                "coldPipelineSeconds": cold["totalPipelineSeconds"],
                "averageHotPipelineSeconds": statistics.fmean(
                    item["totalPipelineSeconds"] for item in hot
                ),
                "fieldEvaluation": hot[-1]["fieldEvaluation"],
                "statusCounts": hot[-1]["statusCounts"],
            }
        )
    return result


def _markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Real Windows CPU PaddleOCR benchmark",
        "",
        "This report contains real local PaddleOCR results on generated synthetic images.",
        "It is not a multi-school accuracy claim and is not connected to the product UI.",
        "",
        "## Environment",
        "",
        f"- Python: `{payload['environment'].get('pythonVersion')}`",
        f"- PaddlePaddle: `{payload['environment'].get('paddlepaddleVersion')}`",
        f"- PaddleOCR: `{payload['environment'].get('paddleocrVersion')}`",
        f"- virtual environment bytes: `{payload['environment'].get('venvBytes')}`",
        "",
        "## Model cache",
        "",
        f"- cache bytes: `{payload['model'].get('cacheBytes')}`",
        f"- observed cache-write duration: `{payload['model'].get('modelDownloadSeconds')}`",
        f"- first initialization including downloads: `{payload['model'].get('bootstrapInitializationSeconds')}`",
        f"- offline cache test: `{payload['offlineCacheTest'].get('success')}`",
        "",
        "## Block versus full-image OCR",
        "",
        "| sample | mode | calls | cold OCR s | hot OCR s | wrong confirmed rate |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for item in payload["comparisons"]:
        rate = item["fieldEvaluation"].get("wrongConfirmedRate")
        lines.append(
            f"| {item['sample']} | {item['ocrMode']} | {item['predictCallCount']} | "
            f"{item['coldInferenceSeconds']:.6f} | {item['averageHotInferenceSeconds']:.6f} | {rate} |"
        )
    lines.extend(
        [
            "",
            "## Result structure",
            "",
            "The machine-readable benchmark contains only type names, public member names, payload keys, shapes and dtypes. Image pixels are not included in the structure probe.",
            "",
            "## Safety conclusion",
            "",
            "Image-source parity `all` is forced to review unless an explicit odd/even marker was recognized. Threshold changes are not promoted to product policy from two synthetic samples.",
        ]
    )
    return "\n".join(lines) + "\n"


def run(output_dir: Path, repo_root: Path, install_metadata: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    samples_dir = output_dir / "samples"
    runs_dir = output_dir / "runs"
    metadata = json.loads(install_metadata.read_text(encoding="utf-8-sig"))

    generated: dict[str, dict[str, Path]] = {}
    for name in ("standard_10", "tilted_12"):
        sample = generate_synthetic_sample(samples_dir, name)
        sample["groundTruth"] = write_ground_truth(name, samples_dir)
        generated[name] = sample

    before = _cache_snapshot()
    bootstrap_started = time.perf_counter()
    with CacheWriteSampler() as cache_sampler:
        bootstrap_engine = PaddleOcrEngine()
    bootstrap_seconds = time.perf_counter() - bootstrap_started
    after = _cache_snapshot()

    probe_image = cv2.imread(str(generated["standard_10"]["image"]))
    probe_started = time.perf_counter()
    prediction = bootstrap_engine._ocr.predict(probe_image)
    probe_seconds = time.perf_counter() - probe_started
    structure = summarize_prediction_structure(prediction)
    offline = _offline_cache_test(generated["standard_10"]["image"])

    runs: list[dict[str, Any]] = []
    for sample_name, sample in generated.items():
        for mode in ("block", "full"):
            engine = PaddleOcrEngine()
            initialization = engine.runtime_info().get("initializationSeconds")
            for run_index in range(4):
                temperature = "cold" if run_index == 0 else "hot"
                run_name = f"{temperature}-{1 if run_index == 0 else run_index}"
                run_dir = runs_dir / sample_name / mode / run_name
                with MemorySampler() as memory:
                    report = recognize_image(
                        input_path=sample["image"],
                        output_dir=run_dir,
                        ocr_engine=engine,
                        repo_root=repo_root,
                        ocr_mode=mode,
                        ground_truth_path=sample["groundTruth"],
                    )
                cache = _cache_snapshot()
                report = _patch_report(
                    run_dir / "report.json",
                    modelDownloadSeconds=(cache_sampler.download_seconds if run_index == 0 else None),
                    initializationSeconds=initialization,
                    coldInferenceSeconds=(report["totalInferenceSeconds"] if run_index == 0 else None),
                    hotInferenceSeconds=(report["totalInferenceSeconds"] if run_index > 0 else None),
                    peakMemoryMb=memory.peak_mb,
                    modelCacheBytes=cache["bytes"],
                )
                ocr_payload = json.loads((run_dir / "ocr.json").read_text(encoding="utf-8"))
                runs.append(
                    {
                        "sample": sample_name,
                        "ocrMode": mode,
                        "temperature": temperature,
                        "runIndex": run_index,
                        "output": str(run_dir),
                        "outputBytes": _directory_size(run_dir),
                        "predictCallCount": report["predictCallCount"],
                        "totalInferenceSeconds": report["totalInferenceSeconds"],
                        "averageInferenceSeconds": report["averageInferenceSeconds"],
                        "maximumInferenceSeconds": report["maximumInferenceSeconds"],
                        "initializationSeconds": initialization,
                        "peakMemoryMb": memory.peak_mb,
                        "totalPipelineSeconds": report["timings"]["totalPipelineSeconds"],
                        "fieldEvaluation": report["fieldEvaluation"],
                        "statusCounts": report["fieldParsing"]["statusCounts"],
                        "recognizedTexts": [token["text"] for token in ocr_payload["tokens"]],
                    }
                )

    payload = {
        "schemaVersion": 1,
        "resultKind": "real PaddleOCR benchmark",
        "environment": metadata,
        "model": {
            "cacheBeforeBytes": before["bytes"],
            "cacheBytes": after["bytes"],
            "cacheRoots": after["roots"],
            "modelDownloadSeconds": cache_sampler.download_seconds,
            "bootstrapInitializationSeconds": bootstrap_seconds,
            "structureProbeSeconds": probe_seconds,
        },
        "offlineCacheTest": offline,
        "predictionStructure": structure,
        "runs": runs,
        "comparisons": _aggregate(runs),
    }
    (output_dir / "benchmark.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "REAL_OCR_BENCHMARK.md").write_text(
        _markdown(payload), encoding="utf-8"
    )
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--install-metadata", required=True)
    args = parser.parse_args(argv)
    try:
        payload = run(Path(args.output), Path(args.repo_root), Path(args.install_metadata))
        print(json.dumps({"success": True, "comparisons": payload["comparisons"]}, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "error": f"{type(error).__name__}: {error}"}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
