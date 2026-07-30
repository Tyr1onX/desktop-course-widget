from __future__ import annotations

import json
import platform
import time
from collections import Counter
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


def _rounded(values: dict[str, float]) -> dict[str, float]:
    return {key: round(float(value), 6) for key, value in values.items()}


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
    timings["blockDetectionSeconds"] = time.perf_counter() - stage
    if not blocks:
        raise RuntimeError("网格已检测，但未定位到课程块")

    all_tokens: list[OcrToken] = []
    course_results = []
    ocr_seconds = 0.0
    parse_seconds = 0.0
    for block in blocks:
        stage = time.perf_counter()
        tokens = ocr_engine.recognize(preprocessed.original_bgr, block.original_box)
        ocr_seconds += time.perf_counter() - stage
        all_tokens.extend(tokens)
        stage = time.perf_counter()
        fields = parse_course_fields(tokens, block, parser_config)
        parse_seconds += time.perf_counter() - stage
        course_results.append((block, fields))
    timings["ocrInferenceSeconds"] = ocr_seconds
    timings["fieldParsingSeconds"] = parse_seconds

    recognizer = ocr_engine.version_info()
    recognizer_text = ";".join(f"{key}={value}" for key, value in recognizer.items())
    warnings = list(
        dict.fromkeys(
            [*grid.warnings, *(warning for block in blocks for warning in block.warnings)]
        )
    )
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

    stage = time.perf_counter()
    draft_path.write_text(
        json.dumps(draft, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    grid_payload = grid.to_dict(preprocessed.original_width, preprocessed.original_height)
    grid_payload["courseBlocks"] = [
        block.to_dict(preprocessed.original_width, preprocessed.original_height)
        for block in blocks
    ]
    grid_path.write_text(
        json.dumps(grid_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    ocr_path.write_text(
        json.dumps(
            {
                "engine": recognizer,
                "tokens": [
                    token.to_dict(preprocessed.original_width, preprocessed.original_height)
                    for token in all_tokens
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    draw_overlay(preprocessed.original_bgr, grid, course_results, overlay_path)
    timings["debugOutputSeconds"] = time.perf_counter() - stage

    stage = time.perf_counter()
    rust = validate_with_rust(draft_path, repo_root)
    timings["rustValidationSeconds"] = time.perf_counter() - stage
    if rust.get("available") is not False and not rust.get("structuralValid", False):
        raise RuntimeError(f"Rust ImportDraft 校验失败：{rust}")

    statuses = Counter(
        evidence["status"]
        for course in draft["courses"]
        for evidence in course["review"]["fields"]
    )
    timings["totalPipelineSeconds"] = time.perf_counter() - started
    report = {
        "success": True,
        "resultKind": (
            "fixture pipeline result"
            if recognizer.get("engine") == "fixture"
            else "real PaddleOCR result"
        ),
        "input": str(Path(input_path)),
        "image": {
            "width": preprocessed.original_width,
            "height": preprocessed.original_height,
            "scale": preprocessed.applied_scale,
            "deskewAngle": preprocessed.deskew_angle,
        },
        "gridBlockDetection": {
            "weekdayColumns": grid.weekday_count,
            "sectionRows": grid.section_count,
            "gridConfidence": grid.confidence,
            "courseBlocks": len(blocks),
            "warnings": grid.warnings,
        },
        "fieldParsing": {
            "statusCounts": {
                "confirmed": statuses.get("confirmed", 0),
                "review": statuses.get("review", 0),
                "missing": statuses.get("missing", 0),
            }
        },
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
        "ocrRuntime": _rounded(ocr_engine.runtime_info()),
        "rustValidation": rust,
        "rustStructuralValidation": rust,
        "timings": _rounded(timings),
        "outputs": {
            "draft": str(draft_path),
            "grid": str(grid_path),
            "ocr": str(ocr_path),
            "overlay": str(overlay_path),
            "report": str(report_path),
        },
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report
