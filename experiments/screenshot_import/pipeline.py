from __future__ import annotations

import json
import platform
import sys
import time
from importlib import metadata
from pathlib import Path
from typing import Any

import cv2

from .blocks import detect_course_blocks
from .draft import build_import_draft
from .grid import detect_grid
from .models import OcrToken
from .ocr import OcrEngine
from .overlay import draw_overlay
from .parse_fields import FieldParserConfig, parse_course_fields
from .preprocess import PreprocessConfig, preprocess_image
from .rust_validate import validate_with_rust


def _version(package: str) -> str:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return "not-installed"


def recognize_image(
    *,
    input_path: str | Path,
    output_dir: str | Path,
    ocr_engine: OcrEngine,
    preprocess_config: PreprocessConfig | None = None,
    parser_config: FieldParserConfig | None = None,
    repo_root: str | Path | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}

    stage = time.perf_counter()
    preprocessed = preprocess_image(input_path, preprocess_config)
    timings["preprocessSeconds"] = time.perf_counter() - stage

    stage = time.perf_counter()
    grid = detect_grid(preprocessed)
    timings["gridSeconds"] = time.perf_counter() - stage

    stage = time.perf_counter()
    blocks = detect_course_blocks(preprocessed, grid)
    timings["blockSeconds"] = time.perf_counter() - stage
    if not blocks:
        raise RuntimeError("网格已检测，但未定位到课程块")

    stage = time.perf_counter()
    all_tokens: list[OcrToken] = []
    course_results = []
    for block in blocks:
        tokens = ocr_engine.recognize(preprocessed.original_bgr, block.original_box)
        all_tokens.extend(tokens)
        fields = parse_course_fields(tokens, block, parser_config)
        course_results.append((block, fields))
    timings["ocrAndParseSeconds"] = time.perf_counter() - stage

    recognizer = ocr_engine.version_info()
    recognizer_text = ";".join(f"{key}={value}" for key, value in recognizer.items())
    warnings = list(dict.fromkeys([*grid.warnings, *(warning for block in blocks for warning in block.warnings)]))
    draft = build_import_draft(
        source_path=input_path,
        image_width=preprocessed.original_width,
        image_height=preprocessed.original_height,
        grid_confidence=grid.confidence,
        section_rows=grid.section_count,
        courses=course_results,
        recognizer_version=recognizer_text,
        warnings=warnings,
    )
    draft_path = output / "draft.json"
    grid_path = output / "grid.json"
    ocr_path = output / "ocr.json"
    overlay_path = output / "overlay.png"
    report_path = output / "report.json"
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    grid_payload = grid.to_dict(preprocessed.original_width, preprocessed.original_height)
    grid_payload["courseBlocks"] = [block.to_dict(preprocessed.original_width, preprocessed.original_height) for block in blocks]
    grid_path.write_text(json.dumps(grid_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    ocr_path.write_text(json.dumps({"engine": recognizer, "tokens": [token.to_dict(preprocessed.original_width, preprocessed.original_height) for token in all_tokens]}, ensure_ascii=False, indent=2), encoding="utf-8")
    draw_overlay(preprocessed.original_bgr, grid, course_results, overlay_path)

    stage = time.perf_counter()
    rust = validate_with_rust(draft_path, repo_root)
    timings["rustValidationSeconds"] = time.perf_counter() - stage
    if rust.get("available") is not False and not rust.get("structuralValid", False):
        raise RuntimeError(f"Rust ImportDraft 校验失败：{rust}")

    pending = sum(
        1 for course in draft["courses"] for evidence in course["review"]["fields"]
        if evidence["status"] in {"review", "missing"}
    )
    timings["totalSeconds"] = time.perf_counter() - started
    report = {
        "success": True,
        "input": str(Path(input_path)),
        "image": {"width": preprocessed.original_width, "height": preprocessed.original_height, "scale": preprocessed.applied_scale, "deskewAngle": preprocessed.deskew_angle},
        "grid": {"weekdayColumns": grid.weekday_count, "sectionRows": grid.section_count, "confidence": grid.confidence, "warnings": grid.warnings},
        "courses": {"blocks": len(blocks), "pendingFields": pending},
        "versions": {
            "python": platform.python_version(),
            "opencv": cv2.__version__,
            "numpy": _version("numpy"),
            "pillow": _version("Pillow"),
            **recognizer,
        },
        "thresholds": {
            "confirmed": (parser_config or FieldParserConfig()).high_confidence,
            "review": (parser_config or FieldParserConfig()).review_confidence,
        },
        "rustValidation": rust,
        "timings": {key: round(value, 6) for key, value in timings.items()},
        "outputs": {"draft": str(draft_path), "grid": str(grid_path), "ocr": str(ocr_path), "overlay": str(overlay_path), "report": str(report_path)},
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report
