from __future__ import annotations

import json
import platform
import time
from collections import Counter
from importlib import metadata
from pathlib import Path
from typing import Any

import cv2

from .benchmark import (
    assign_tokens_to_blocks,
    enforce_image_parity_review,
    evaluate_draft,
    load_ground_truth,
    validate_confidence_thresholds,
    validate_overlap_threshold,
)
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


def _rounded_runtime(values: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in values.items():
        if isinstance(value, float):
            result[key] = round(value, 6)
        elif isinstance(value, list):
            result[key] = [round(item, 6) if isinstance(item, float) else item for item in value]
        else:
            result[key] = value
    return result


def recognize_image(
    *,
    input_path: str | Path,
    output_dir: str | Path,
    ocr_engine: OcrEngine,
    preprocess_config: PreprocessConfig | None = None,
    parser_config: FieldParserConfig | None = None,
    repo_root: str | Path | None = None,
    ocr_mode: str = "block",
    assignment_overlap_threshold: float = 0.35,
    ground_truth_path: str | Path | None = None,
) -> dict[str, Any]:
    parser_config = parser_config or FieldParserConfig()
    validate_confidence_thresholds(
        parser_config.review_confidence, parser_config.high_confidence
    )
    validate_overlap_threshold(assignment_overlap_threshold)
    if ocr_mode not in {"block", "full"}:
        raise ValueError("ocr-mode must be either block or full")

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
    inference_durations: list[float] = []
    parse_seconds = 0.0
    assignment_debug: dict[str, Any] = {
        "assignedCounts": [],
        "ambiguous": [],
        "unassigned": [],
    }

    if ocr_mode == "block":
        tokens_by_block: list[list[OcrToken]] = []
        for block in blocks:
            stage = time.perf_counter()
            tokens = ocr_engine.recognize(preprocessed.original_bgr, block.original_box)
            inference_durations.append(time.perf_counter() - stage)
            tokens_by_block.append(tokens)
            all_tokens.extend(tokens)
        assignment_debug["assignedCounts"] = [len(tokens) for tokens in tokens_by_block]
    else:
        stage = time.perf_counter()
        all_tokens = ocr_engine.recognize(
            preprocessed.original_bgr, grid.original_table_box
        )
        inference_durations.append(time.perf_counter() - stage)
        assignment = assign_tokens_to_blocks(
            all_tokens,
            blocks,
            overlap_threshold=assignment_overlap_threshold,
        )
        tokens_by_block = assignment.by_block
        assignment_debug = assignment.debug_dict(
            preprocessed.original_width, preprocessed.original_height
        )

    for block, tokens in zip(blocks, tokens_by_block):
        stage = time.perf_counter()
        fields = parse_course_fields(tokens, block, parser_config)
        enforce_image_parity_review(fields)
        parse_seconds += time.perf_counter() - stage
        course_results.append((block, fields))

    total_inference_seconds = sum(inference_durations)
    timings["ocrInferenceSeconds"] = total_inference_seconds
    timings["fieldParsingSeconds"] = parse_seconds

    recognizer = ocr_engine.version_info()
    recognizer_text = ";".join(f"{key}={value}" for key, value in recognizer.items())
    warnings = list(
        dict.fromkeys(
            [*grid.warnings, *(warning for block in blocks for warning in block.warnings)]
        )
    )
    if assignment_debug["ambiguous"]:
        warnings.append(
            f"{len(assignment_debug['ambiguous'])} 个 OCR token 同时匹配多个课程块，需要复核"
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
    diagnostics = getattr(ocr_engine, "diagnostics", lambda: {})()
    ocr_path.write_text(
        json.dumps(
            {
                "engine": recognizer,
                "ocrMode": ocr_mode,
                "tokens": [
                    token.to_dict(preprocessed.original_width, preprocessed.original_height)
                    for token in all_tokens
                ],
                "assignment": assignment_debug,
                "resultStructure": diagnostics.get("resultStructure"),
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
    evaluation = None
    if ground_truth_path is not None:
        evaluation = evaluate_draft(draft, load_ground_truth(ground_truth_path))

    timings["totalPipelineSeconds"] = time.perf_counter() - started
    runtime = _rounded_runtime(ocr_engine.runtime_info())
    report = {
        "success": True,
        "resultKind": (
            "fixture pipeline result"
            if recognizer.get("engine") == "fixture"
            else "real PaddleOCR result"
        ),
        "ocrMode": ocr_mode,
        "predictCallCount": len(inference_durations),
        "modelDownloadSeconds": runtime.get("modelDownloadSeconds"),
        "initializationSeconds": runtime.get("initializationSeconds"),
        "coldInferenceSeconds": None,
        "hotInferenceSeconds": None,
        "totalInferenceSeconds": round(total_inference_seconds, 6),
        "averageInferenceSeconds": (
            round(total_inference_seconds / len(inference_durations), 6)
            if inference_durations
            else None
        ),
        "maximumInferenceSeconds": (
            round(max(inference_durations), 6) if inference_durations else None
        ),
        "peakMemoryMb": runtime.get("peakMemoryMb"),
        "modelCacheBytes": runtime.get("modelCacheBytes"),
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
        "fieldEvaluation": evaluation,
        "autoConfirmationErrors": (
            evaluation.get("autoConfirmationErrors", []) if evaluation else []
        ),
        "wrongConfirmedRate": (
            evaluation.get("wrongConfirmedRate") if evaluation else None
        ),
        "groundTruthSource": (
            evaluation.get("groundTruthSource") if evaluation else None
        ),
        "versions": {
            "python": platform.python_version(),
            "opencv": cv2.__version__,
            "numpy": _version("numpy"),
            "pillow": _version("Pillow"),
            **recognizer,
        },
        "thresholds": {
            "confirmed": parser_config.high_confidence,
            "review": parser_config.review_confidence,
            "assignmentOverlap": assignment_overlap_threshold,
        },
        "ocrRuntime": runtime,
        "ocrDiagnostics": diagnostics,
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
