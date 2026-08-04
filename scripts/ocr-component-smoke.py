from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path
from typing import Any


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
    parser.add_argument("--generate-sample", action="store_true")
    return parser.parse_args()


def _font(size: int, *, bold: bool = False):
    from PIL import ImageFont

    candidates = [
        Path(r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def generate_sample(path: Path) -> list[int]:
    from PIL import Image, ImageDraw

    width, height = 1540, 1160
    margin = 32
    section_width = 82
    header_height = 72
    day_width = (width - margin * 2 - section_width) // 7
    row_height = (height - margin * 2 - header_height) // 10
    table_left = margin + section_width
    table_top = margin + header_height

    image = Image.new("RGB", (width, height), (250, 251, 252))
    draw = ImageDraw.Draw(image)
    header_font = _font(20, bold=True)
    section_font = _font(16)
    course_font = _font(18, bold=True)
    detail_font = _font(13)

    weekdays = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")
    for index, title in enumerate(weekdays):
        left = table_left + index * day_width
        draw.rectangle(
            (left, margin, left + day_width, table_top),
            fill=(241, 245, 250),
            outline=(193, 201, 211),
            width=1,
        )
        box = draw.textbbox((0, 0), title, font=header_font)
        draw.text(
            (left + (day_width - (box[2] - box[0])) / 2, margin + 22),
            title,
            font=header_font,
            fill=(31, 35, 40),
        )

    for section in range(1, 11):
        top = table_top + (section - 1) * row_height
        draw.rectangle(
            (margin, top, table_left, top + row_height),
            fill=(246, 247, 249),
            outline=(205, 211, 219),
            width=1,
        )
        label = str(section)
        box = draw.textbbox((0, 0), label, font=section_font)
        draw.text(
            (
                margin + (section_width - (box[2] - box[0])) / 2,
                top + (row_height - (box[3] - box[1])) / 2,
            ),
            label,
            font=section_font,
            fill=(92, 101, 112),
        )

    courses = (
        (1, 1, 2, "通信原理", "1-16周 张老师", "南湖一教四阶", (223, 239, 255)),
        (3, 3, 4, "数字信号处理", "1-16周 李老师", "南湖一教七阶", (239, 231, 255)),
        (5, 5, 6, "单片机原理及应用", "1-15周(单)", "南岭逸夫楼A203", (225, 247, 233)),
        (7, 8, 9, "通信与网络", "2-16周(双)", "前卫经信楼B201", (255, 238, 219)),
    )
    for weekday, start, end, name, weeks, location, fill in courses:
        left = table_left + (weekday - 1) * day_width + 5
        right = table_left + weekday * day_width - 5
        top = table_top + (start - 1) * row_height + 5
        bottom = table_top + end * row_height - 5
        draw.rounded_rectangle(
            (left, top, right, bottom),
            radius=9,
            fill=fill,
            outline=(126, 139, 154),
            width=2,
        )
        draw.text((left + 8, top + 9), name, font=course_font, fill=(29, 36, 45))
        draw.text((left + 8, top + 40), weeks, font=detail_font, fill=(62, 72, 84))
        draw.text((left + 8, top + 64), location, font=detail_font, fill=(62, 72, 84))

    for index in range(8):
        x = table_left + index * day_width
        draw.line((x, table_top, x, table_top + 10 * row_height), fill=(210, 215, 222), width=1)
    for index in range(11):
        y = table_top + index * row_height
        draw.line((table_left, y, table_left + 7 * day_width, y), fill=(210, 215, 222), width=1)

    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=False)
    return [width, height]


def main() -> int:
    configure_console_encoding()
    args = parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)

    import cv2
    import experiments
    import numpy
    import paddle
    import paddleocr

    from experiments.screenshot_import.ocr_first_pipeline import recognize_ocr_first_image
    from experiments.screenshot_import.paddle_cpu import WindowsCpuPaddleOcrEngine
    from experiments.screenshot_import.preprocess import PreprocessConfig

    module_root = Path(experiments.__file__).resolve().parent.parent
    report: dict[str, Any] = {
        "python": sys.version,
        "executable": str(Path(sys.executable).resolve()),
        "moduleRoot": str(module_root),
        "platform": platform.platform(),
        "versions": {
            "numpy": numpy.__version__,
            "opencv": cv2.__version__,
            "paddle": paddle.__version__,
            "paddleocr": getattr(paddleocr, "__version__", "unknown"),
        },
        "inferenceRequested": bool(args.inference),
    }

    sample_image: Path | None = None
    if args.inference or args.generate_sample:
        sample_image = output / "课表识别样本.png"
        report["sampleSize"] = generate_sample(sample_image)
        report["sampleImage"] = str(sample_image)

    if args.inference:
        if sample_image is None:
            raise RuntimeError("portable OCR smoke did not prepare its sample image")
        initialization_started = time.perf_counter()
        engine = WindowsCpuPaddleOcrEngine()
        initialization_seconds = time.perf_counter() - initialization_started
        pipeline_output = output / "production-runtime"
        pipeline_started = time.perf_counter()
        pipeline_report = recognize_ocr_first_image(
            input_path=sample_image,
            output_dir=pipeline_output,
            ocr_engine=engine,
            preprocess_config=PreprocessConfig(max_dimension=1600, deskew=False),
            repo_root=module_root,
            write_diagnostics=False,
        )
        pipeline_seconds = time.perf_counter() - pipeline_started
        draft_path = pipeline_output / "draft.json"
        if not draft_path.is_file():
            raise RuntimeError("production OCR runtime did not write draft.json")
        draft = json.loads(draft_path.read_text(encoding="utf-8"))
        courses = draft.get("courses")
        if not isinstance(courses, list) or not courses:
            raise RuntimeError("production OCR runtime returned no courses")
        if (pipeline_output / "overlay.png").exists() or (pipeline_output / "ocr.json").exists():
            raise RuntimeError("production OCR runtime wrote development-only diagnostics")

        report["engine"] = engine.version_info()
        report["runtime"] = engine.runtime_info()
        report["initializationSeconds"] = round(initialization_seconds, 6)
        report["pipelineSeconds"] = round(pipeline_seconds, 6)
        report["courseCount"] = len(courses)
        report["timings"] = pipeline_report.get("timings", {})
        report["image"] = pipeline_report.get("image", {})
        report["productionDraft"] = str(draft_path)

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    (output / "portable-ocr-smoke.json").write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
