from __future__ import annotations

import json
import math
import time
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from statistics import median
from typing import Any

from .benchmark import (
    assign_tokens_to_blocks,
    enforce_image_parity_review,
    evaluate_draft,
    load_ground_truth,
)
from .blocks import detect_course_blocks
from .draft import build_import_draft
from .grid import detect_grid
from .models import PixelBox
from .ocr import OcrEngine
from .ocr_first import discover_ocr_first_courses
from .ocr_first_fields import enforce_ocr_first_text_review, parse_ocr_first_course_fields
from .ocr_first_output import write_ocr_first_outputs
from .parse_fields import FieldParserConfig
from .preprocess import PreprocessConfig, map_tokens_to_original, preprocess_image
from .rust_validate import validate_with_rust

StageCallback = Callable[[str, str, str], None]


def _emit_stage(
    callback: StageCallback | None,
    stage: str,
    title: str,
    detail: str,
) -> None:
    if callback is not None:
        callback(stage, title, detail)


def _optional_grid_geometry_error(grid: Any, image_width: int) -> str | None:
    columns = getattr(grid, "weekday_columns", None)
    if not isinstance(columns, list) or len(columns) != 7:
        actual = len(columns) if isinstance(columns, list) else 0
        return f"网格星期列数量异常：需要 7 列，实际为 {actual} 列"

    widths = [float(getattr(column, "width", 0.0)) for column in columns]
    if any(not math.isfinite(width) or width <= 0 for width in widths):
        return "网格星期列包含无效宽度"

    typical_width = float(median(widths))
    minimum_allowed = max(float(image_width) * 0.01, typical_width * 0.35)
    narrowest = min(widths)
    if narrowest < minimum_allowed:
        return (
            "网格星期列宽度退化："
            f"最窄列 {narrowest:.1f}px，典型列 {typical_width:.1f}px，"
            f"至少需要 {minimum_allowed:.1f}px"
        )
    return None


def _has_usable_course_name(fields: dict[str, Any]) -> bool:
    name = fields.get("name")
    value = getattr(name, "value", None)
    status = getattr(name, "status", None)
    if status == "missing" or not isinstance(value, str):
        return False
    normalized = value.strip()
    return bool(normalized and normalized != "未识别课程")


def recognize_ocr_first_image(
    *,
    input_path: str | Path,
    output_dir: str | Path,
    ocr_engine: OcrEngine,
    preprocess_config: PreprocessConfig | None = None,
    parser_config: FieldParserConfig | None = None,
    repo_root: str | Path | None = None,
    assignment_overlap_threshold: float = 0.35,
    ground_truth_path: str | Path | None = None,
    stage_callback: StageCallback | None = None,
) -> dict[str, Any]:
    parser_config = parser_config or FieldParserConfig()
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    _emit_stage(
        stage_callback,
        "preprocessing-image",
        "正在优化课表图片…",
        "正在缩放并整理图片，减少不必要的本地计算。",
    )
    stage = time.perf_counter()
    image = preprocess_image(input_path, preprocess_config)
    preprocess_seconds = time.perf_counter() - stage

    working_height, working_width = image.working_bgr.shape[:2]
    working_region = PixelBox(0, 0, float(working_width), float(working_height))
    _emit_stage(
        stage_callback,
        "recognizing-text",
        "正在识别课表文字…",
        "正在分析星期、节次和课程内容。",
    )
    stage = time.perf_counter()
    working_tokens = ocr_engine.recognize(image.working_bgr, working_region)
    tokens = map_tokens_to_original(working_tokens, image)
    ocr_seconds = time.perf_counter() - stage

    _emit_stage(
        stage_callback,
        "organizing-courses",
        "正在整理课程信息…",
        "正在组合课程名、周次、节次、地点和教师。",
    )
    try:
        candidate_grid = detect_grid(image)
        geometry_error = _optional_grid_geometry_error(
            candidate_grid,
            image.original_width,
        )
        if geometry_error:
            grid, grid_error = None, geometry_error
        else:
            grid, grid_error = candidate_grid, None
    except Exception as error:
        grid, grid_error = None, str(error)

    found = discover_ocr_first_courses(
        tokens,
        image_width=image.original_width,
        image_height=image.original_height,
        grid=grid,
    )
    blocks, grouped, strategy = found.blocks, found.tokens_by_block, "ocr-first"
    if not blocks and grid is not None:
        legacy = detect_course_blocks(image, grid)
        if legacy:
            assigned = assign_tokens_to_blocks(
                tokens,
                legacy,
                overlap_threshold=assignment_overlap_threshold,
            )
            blocks, grouped, strategy = (
                legacy,
                assigned.by_block,
                "ocr-first+structural-fallback",
            )
    if not blocks:
        raise RuntimeError(
            "整图 OCR 已完成，但未形成课程记录：" + "；".join(found.warnings)
        )

    courses = []
    for block, course_tokens in zip(blocks, grouped):
        fields = parse_ocr_first_course_fields(course_tokens, block, parser_config)
        enforce_ocr_first_text_review(fields)
        enforce_image_parity_review(fields)
        courses.append((block, fields))
    if not any(_has_usable_course_name(fields) for _, fields in courses):
        raise RuntimeError(
            "整图 OCR 已完成，但未形成课程记录：识别结果中没有可用课程名称"
        )

    warnings = [*image.warnings, *found.warnings]
    warnings.extend(
        grid.warnings
        if grid
        else [f"网格辅助不可用：{grid_error}"]
        if grid_error
        else []
    )
    warnings.extend(warning for block in blocks for warning in block.warnings)
    warnings = list(dict.fromkeys(warnings))
    section_rows = grid.section_count if grid else max(block.end_section for block in blocks)
    confidence = grid.confidence if grid else found.confidence
    engine = ocr_engine.version_info()
    draft = build_import_draft(
        source_path=input_path,
        image_width=image.original_width,
        image_height=image.original_height,
        grid_confidence=confidence,
        section_rows=section_rows,
        courses=courses,
        recognizer_version=";".join(f"{key}={value}" for key, value in engine.items()),
        warnings=warnings,
    )
    structure = {
        "recognitionStrategy": strategy,
        "tableBox": found.table_box.to_dict() if found.table_box else None,
        "weekdayCenters": found.weekday_centers,
        "sectionCenters": found.section_centers,
        "courseBlocks": [
            block.to_dict(image.original_width, image.original_height) for block in blocks
        ],
        "ocrFirst": found.diagnostics(),
        "optionalGrid": (
            grid.to_dict(image.original_width, image.original_height) if grid else None
        ),
        "optionalGridError": grid_error,
        "warnings": warnings,
    }

    _emit_stage(
        stage_callback,
        "writing-result",
        "正在生成复核结果…",
        "识别已完成，正在保存本次临时结果。",
    )
    outputs = write_ocr_first_outputs(
        output=output,
        image=image.original_bgr,
        image_width=image.original_width,
        image_height=image.original_height,
        table_box=found.table_box,
        course_results=courses,
        tokens=tokens,
        engine=engine,
        structure=structure,
        draft=draft,
    )
    rust = validate_with_rust(outputs["draft"], repo_root)
    if rust.get("available") is not False and not rust.get("structuralValid", False):
        raise RuntimeError(f"Rust ImportDraft 校验失败：{rust}")
    evaluation = (
        evaluate_draft(draft, load_ground_truth(ground_truth_path))
        if ground_truth_path
        else None
    )
    statuses = Counter(
        evidence["status"]
        for course in draft["courses"]
        for evidence in course["review"]["fields"]
    )
    report = {
        "success": True,
        "ocrMode": "ocr-first",
        "recognitionStrategy": strategy,
        "predictCallCount": 1,
        "courseCount": len(blocks),
        "fieldEvaluation": evaluation,
        "fieldParsing": {
            "statusCounts": {
                key: statuses.get(key, 0)
                for key in ("confirmed", "review", "missing")
            }
        },
        "optionalGridAvailable": grid is not None,
        "optionalGridError": grid_error,
        "warnings": warnings,
        "rustValidation": rust,
        "image": {
            "originalWidth": image.original_width,
            "originalHeight": image.original_height,
            "workingWidth": working_width,
            "workingHeight": working_height,
            "scale": round(image.applied_scale, 6),
            "deskewAngle": round(image.deskew_angle, 6),
        },
        "timings": {
            "preprocessSeconds": round(preprocess_seconds, 6),
            "ocrInferenceSeconds": round(ocr_seconds, 6),
            "totalPipelineSeconds": round(time.perf_counter() - started, 6),
        },
        "outputs": outputs,
    }
    Path(outputs["report"]).write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report
