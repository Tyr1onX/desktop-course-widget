from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from importlib import metadata
from pathlib import Path
from typing import Any


def configure_console_encoding() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def package_version(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "unknown"


def classify_error(error: BaseException) -> str:
    text = f"{type(error).__name__}: {error}".lower()
    if "dll load failed" in text or "winerror 126" in text or "winerror 193" in text:
        return "native-dll-load"
    if isinstance(error, ModuleNotFoundError):
        return "module-missing"
    if isinstance(error, ImportError):
        return "import-error"
    if "model" in text:
        return "model-initialization"
    return "runtime-error"


def path_is_within(path: str | Path, root: str | Path) -> bool:
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except (OSError, ValueError):
        return False


def quick_probe() -> dict[str, Any]:
    started = time.perf_counter()
    import cv2
    import numpy
    import paddle
    import paddleocr
    import experiments.screenshot_import

    module_root = Path(experiments.screenshot_import.__file__).resolve().parents[2]
    python_root = Path(sys.prefix).resolve()
    imported_files = {
        "numpy": getattr(numpy, "__file__", ""),
        "cv2": getattr(cv2, "__file__", ""),
        "paddle": getattr(paddle, "__file__", ""),
        "paddleocr": getattr(paddleocr, "__file__", ""),
        "screenshotImport": getattr(experiments.screenshot_import, "__file__", ""),
    }
    outside_runtime = {
        name: value
        for name, value in imported_files.items()
        if value and not path_is_within(value, python_root) and not path_is_within(value, module_root)
    }
    if outside_runtime:
        raise RuntimeError(
            "isolated probe imported modules outside the packaged runtime: "
            + ", ".join(sorted(outside_runtime))
        )

    return {
        "ok": True,
        "level": "quick",
        "elapsedSeconds": time.perf_counter() - started,
        "pythonVersion": sys.version.split()[0],
        "versions": {
            "numpy": package_version("numpy"),
            "opencv": package_version("opencv-contrib-python"),
            "paddle": package_version("paddlepaddle"),
            "paddleocr": package_version("paddleocr"),
        },
        "executableName": Path(sys.executable).name,
        "moduleRootName": module_root.name,
        "isolated": bool(sys.flags.isolated),
        "noUserSite": bool(getattr(sys.flags, "no_user_site", 0)),
    }


def initialization_probe(run_inference: bool) -> dict[str, Any]:
    import numpy as np

    from .models import PixelBox
    from .paddle_cpu import WindowsCpuPaddleOcrEngine

    started = time.perf_counter()
    engine = WindowsCpuPaddleOcrEngine()
    initialization_seconds = time.perf_counter() - started
    inference_seconds = None
    token_count = None

    if run_inference:
        image = np.full((64, 256, 3), 255, dtype=np.uint8)
        inference_started = time.perf_counter()
        tokens = engine.recognize(
            image,
            PixelBox(x=0.0, y=0.0, width=float(image.shape[1]), height=float(image.shape[0])),
        )
        inference_seconds = time.perf_counter() - inference_started
        token_count = len(tokens)

    return {
        "ok": True,
        "level": "initialize",
        "initializationSeconds": initialization_seconds,
        "inferenceSeconds": inference_seconds,
        "tokenCount": token_count,
        "engine": engine.version_info(),
        "runtime": engine.runtime_info(),
        "isolated": bool(sys.flags.isolated),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe the bundled screenshot OCR runtime")
    parser.add_argument("level", choices=["quick", "initialize"])
    parser.add_argument("--inference", action="store_true")
    parser.add_argument("--output")
    return parser.parse_args()


def main() -> int:
    configure_console_encoding()
    args = parse_args()
    try:
        report = quick_probe() if args.level == "quick" else initialization_probe(args.inference)
        code = 0
    except Exception as error:
        report = {
            "ok": False,
            "level": args.level,
            "category": classify_error(error),
            "errorType": type(error).__name__,
            "message": str(error),
            "tracebackTail": traceback.format_exc().splitlines()[-8:],
        }
        code = 1

    rendered = json.dumps(report, ensure_ascii=False)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
