from __future__ import annotations

import argparse
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import psutil

from .models import PixelBox
from .ocr import PaddleOcrEngine
from .synthetic import generate_synthetic_sample

CACHE_CANDIDATES = (
    Path.home() / ".paddlex",
    Path.home() / ".paddleocr",
    Path(os.environ.get("LOCALAPPDATA", "")) / "paddlex",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _model_directories(root: Path) -> list[dict[str, Any]]:
    result = []
    if not root.exists():
        return result
    for directory in root.rglob("*"):
        try:
            if not directory.is_dir():
                continue
            files = [item for item in directory.iterdir() if item.is_file()]
        except OSError:
            continue
        if not files:
            continue
        names = {item.name.lower() for item in files}
        looks_like_model = any(
            name.endswith((".pdmodel", ".pdiparams", ".json", ".yml", ".yaml"))
            for name in names
        )
        if looks_like_model:
            result.append(
                {
                    "name": directory.name,
                    "path": str(directory),
                    "bytes": _directory_size(directory),
                    "fileCount": len(files),
                }
            )
    unique = {item["path"]: item for item in result}
    return sorted(unique.values(), key=lambda item: item["path"])


def cache_snapshot() -> dict[str, Any]:
    roots = []
    total = 0
    models: list[dict[str, Any]] = []
    for path in CACHE_CANDIDATES:
        if not str(path) or not path.exists():
            continue
        size = _directory_size(path)
        total += size
        models.extend(_model_directories(path))
        roots.append({"path": str(path), "bytes": size})
    return {"bytes": total, "roots": roots, "modelDirectories": models}


class CacheSampler:
    def __init__(self) -> None:
        self.last_bytes = cache_snapshot()["bytes"]
        self.first_change_utc: str | None = None
        self.last_change_utc: str | None = None
        self.first_change_perf: float | None = None
        self.last_change_perf: float | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _record(self, current: int) -> None:
        if current == self.last_bytes:
            return
        now_perf = time.perf_counter()
        now_utc = _utc_now()
        if self.first_change_perf is None:
            self.first_change_perf = now_perf
            self.first_change_utc = now_utc
        self.last_change_perf = now_perf
        self.last_change_utc = now_utc
        self.last_bytes = current

    def _run(self) -> None:
        while not self._stop.wait(0.1):
            self._record(cache_snapshot()["bytes"])

    def __enter__(self) -> "CacheSampler":
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        self._record(cache_snapshot()["bytes"])

    @property
    def seconds(self) -> float | None:
        if self.first_change_perf is None or self.last_change_perf is None:
            return None
        return max(0.0, self.last_change_perf - self.first_change_perf)


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


def run(output: Path) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    sample = generate_synthetic_sample(output / "sample", "standard_10")
    image = cv2.imread(str(sample["image"]))
    if image is None:
        raise RuntimeError("could not read generated bootstrap image")

    before = cache_snapshot()
    process = psutil.Process()
    initialization_started_utc = _utc_now()
    initialization_started = time.perf_counter()
    with CacheSampler() as cache, MemorySampler() as memory:
        engine = PaddleOcrEngine()
        initialization_seconds = time.perf_counter() - initialization_started
        initialization_ended_utc = _utc_now()
        rss_after_initialization = process.memory_info().rss
        prediction_started_utc = _utc_now()
        prediction_started = time.perf_counter()
        tokens = engine.recognize(
            image,
            PixelBox(0.0, 0.0, float(image.shape[1]), float(image.shape[0])),
        )
        prediction_seconds = time.perf_counter() - prediction_started
        prediction_ended_utc = _utc_now()
    after = cache_snapshot()

    payload = {
        "success": True,
        "cacheBeforeBytes": before["bytes"],
        "cacheBytes": after["bytes"],
        "cacheRoots": after["roots"],
        "modelDirectories": after["modelDirectories"],
        "modelDownloadStartedUtc": cache.first_change_utc,
        "modelDownloadEndedUtc": cache.last_change_utc,
        "modelDownloadSeconds": cache.seconds,
        "initializationStartedUtc": initialization_started_utc,
        "initializationEndedUtc": initialization_ended_utc,
        "initializationSeconds": initialization_seconds,
        "initializationRssMb": round(rss_after_initialization / 1024 / 1024, 3),
        "bootstrapPeakMemoryMb": round(memory.peak / 1024 / 1024, 3),
        "firstPredictionStartedUtc": prediction_started_utc,
        "firstPredictionEndedUtc": prediction_ended_utc,
        "firstPredictionSeconds": prediction_seconds,
        "firstPredictionTokenCount": len(tokens),
        "resultStructure": engine.diagnostics().get("resultStructure"),
    }
    (output / "model-bootstrap.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(Path(args.output))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(
            json.dumps(
                {"success": False, "error": f"{type(error).__name__}: {error}"},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
