from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path


def configure_console_encoding() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate the portable screenshot OCR component")
    parser.add_argument("--output", required=True)
    parser.add_argument("--inference", action="store_true")
    return parser.parse_args()


def main() -> int:
    configure_console_encoding()
    args = parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)

    import cv2
    import numpy
    import paddle
    import paddleocr
    from PIL import Image

    from experiments.screenshot_import.models import PixelBox
    from experiments.screenshot_import.paddle_cpu import WindowsCpuPaddleOcrEngine
    from experiments.screenshot_import.synthetic_chinese_corpus import (
        generate_chinese_timetable_sample,
    )

    report: dict[str, object] = {
        "python": sys.version,
        "executable": str(Path(sys.executable).resolve()),
        "platform": platform.platform(),
        "versions": {
            "numpy": numpy.__version__,
            "opencv": cv2.__version__,
            "paddle": paddle.__version__,
            "paddleocr": getattr(paddleocr, "__version__", "unknown"),
        },
        "inferenceRequested": bool(args.inference),
    }

    if args.inference:
        sample = generate_chinese_timetable_sample(output / "sample", "mobile_cards_12")
        image = cv2.imread(str(sample["image"]), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("portable OCR smoke sample could not be decoded")
        height, width = image.shape[:2]
        engine = WindowsCpuPaddleOcrEngine(cpu_threads=2)
        tokens = engine.recognize(
            image,
            PixelBox(x=0.0, y=0.0, width=float(width), height=float(height)),
        )
        visible = [token.text.strip() for token in tokens if token.text.strip()]
        if len(visible) < 4:
            raise RuntimeError(
                f"portable OCR inference returned too few text tokens: {visible!r}"
            )
        with Image.open(sample["image"]) as generated:
            report["sampleSize"] = list(generated.size)
        report["tokenCount"] = len(visible)
        report["tokenPreview"] = visible[:12]
        report["engine"] = engine.version_info()
        report["runtime"] = engine.runtime_info()

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    (output / "portable-ocr-smoke.json").write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
