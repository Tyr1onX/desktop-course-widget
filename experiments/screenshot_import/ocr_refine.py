from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

import cv2
import numpy as np

from .models import CourseBlock, OcrToken, ParsedField, PixelBox
from .ocr import OcrEngine
from .ocr_first_fields import parse_ocr_first_course_fields
from .parse_fields import FieldParserConfig, normalize_text


@dataclass(frozen=True)
class _VariantArea:
    course_index: int
    variant_index: int
    x1: float
    y1: float
    x2: float
    y2: float

    def contains(self, token: OcrToken) -> bool:
        x, y = token.box.center
        return self.x1 <= x <= self.x2 and self.y1 <= y <= self.y2


def _compact(value: object) -> str:
    return re.sub(r"\s+", "", normalize_text(str(value)))


def _padded_crop(image_bgr: np.ndarray, box: PixelBox) -> np.ndarray | None:
    height, width = image_bgr.shape[:2]
    horizontal = max(8.0, box.height * 0.8)
    vertical = max(4.0, box.height * 0.35)
    padded = PixelBox(
        box.x - horizontal,
        box.y - vertical,
        box.width + horizontal * 2.0,
        box.height + vertical * 2.0,
    ).clipped(width, height)
    x1 = max(0, int(np.floor(padded.x)))
    y1 = max(0, int(np.floor(padded.y)))
    x2 = min(width, int(np.ceil(padded.right)))
    y2 = min(height, int(np.ceil(padded.bottom)))
    if x2 <= x1 or y2 <= y1:
        return None
    return image_bgr[y1:y2, x1:x2].copy()


def _variants(crop: np.ndarray) -> list[np.ndarray]:
    target_height = 56.0
    scale = max(2.0, min(4.0, target_height / max(1.0, float(crop.shape[0]))))
    resized = cv2.resize(
        crop,
        (
            max(1, int(round(crop.shape[1] * scale))),
            max(1, int(round(crop.shape[0] * scale))),
        ),
        interpolation=cv2.INTER_CUBIC,
    )

    lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced_lightness = clahe.apply(lightness)
    enhanced_color = cv2.cvtColor(
        cv2.merge([enhanced_lightness, channel_a, channel_b]),
        cv2.COLOR_LAB2BGR,
    )
    blurred = cv2.GaussianBlur(enhanced_color, (0, 0), 1.0)
    sharpened = cv2.addWeighted(enhanced_color, 1.7, blurred, -0.7, 0)

    gray = cv2.cvtColor(sharpened, cv2.COLOR_BGR2GRAY)
    gray_bgr = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary_bgr = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    return [resized, gray_bgr, binary_bgr]


def _candidate_from_tokens(
    tokens: list[OcrToken],
    block: CourseBlock,
    config: FieldParserConfig,
) -> ParsedField | None:
    if not tokens:
        return None
    candidate = parse_ocr_first_course_fields(tokens, block, config).get("location")
    if candidate is None or candidate.status == "missing" or not _compact(candidate.value):
        return None
    if (candidate.confidence or 0.0) < config.review_confidence:
        return None
    return candidate


def refine_location_fields(
    image_bgr: np.ndarray,
    ocr_engine: OcrEngine,
    courses: list[tuple[CourseBlock, dict[str, ParsedField]]],
    parser_config: FieldParserConfig | None = None,
) -> dict[str, Any]:
    """Re-read recognized location lines from a single high-resolution contact sheet.

    Whole-image OCR can make a stable character error when timetable text is small.
    Each recognized location line is therefore rendered in color-enhanced, grayscale,
    and binary forms.  One additional OCR call reads the entire contact sheet.  A
    different value replaces the whole-image result only when at least two local
    variants agree and remain close to the original text.  This is intentionally
    generic and does not contain school, campus, or phrase substitutions.
    """

    config = parser_config or FieldParserConfig()
    prepared: list[tuple[int, CourseBlock, ParsedField, list[np.ndarray]]] = []
    for course_index, (block, fields) in enumerate(courses):
        location = fields.get("location")
        if location is None or location.box is None or not _compact(location.value):
            continue
        crop = _padded_crop(image_bgr, location.box)
        if crop is None:
            continue
        prepared.append((course_index, block, location, _variants(crop)))

    if not prepared:
        return {
            "attemptedCourseCount": 0,
            "changedCourseCount": 0,
            "changedCourseIndexes": [],
            "predictCallCount": 0,
        }

    margin = 24
    column_gap = 24
    row_gap = 20
    variant_count = 3
    maximum_width = max(variant.shape[1] for _, _, _, variants in prepared for variant in variants)
    row_heights = [max(variant.shape[0] for variant in variants) for _, _, _, variants in prepared]
    sheet_width = margin * 2 + maximum_width * variant_count + column_gap * (variant_count - 1)
    sheet_height = margin * 2 + sum(row_heights) + row_gap * max(0, len(row_heights) - 1)
    sheet = np.full((sheet_height, sheet_width, 3), 255, dtype=np.uint8)

    areas: list[_VariantArea] = []
    cursor_y = margin
    for (course_index, _, _, variants), row_height in zip(prepared, row_heights):
        for variant_index, variant in enumerate(variants):
            x = margin + variant_index * (maximum_width + column_gap)
            y = cursor_y + (row_height - variant.shape[0]) // 2
            sheet[y:y + variant.shape[0], x:x + variant.shape[1]] = variant
            areas.append(
                _VariantArea(
                    course_index=course_index,
                    variant_index=variant_index,
                    x1=float(x),
                    y1=float(y),
                    x2=float(x + variant.shape[1]),
                    y2=float(y + variant.shape[0]),
                )
            )
        cursor_y += row_height + row_gap

    tokens = ocr_engine.recognize(
        sheet,
        PixelBox(0.0, 0.0, float(sheet_width), float(sheet_height)),
    )
    by_area: dict[tuple[int, int], list[OcrToken]] = defaultdict(list)
    for token in tokens:
        for area in areas:
            if area.contains(token):
                by_area[(area.course_index, area.variant_index)].append(token)
                break

    prepared_by_index = {
        course_index: (block, location)
        for course_index, block, location, _ in prepared
    }
    candidates: dict[int, list[ParsedField]] = defaultdict(list)
    for area in areas:
        block, _ = prepared_by_index[area.course_index]
        candidate = _candidate_from_tokens(
            by_area.get((area.course_index, area.variant_index), []),
            block,
            config,
        )
        if candidate is not None:
            candidates[area.course_index].append(candidate)

    changed_indexes: list[int] = []
    consensus_counts: dict[int, int] = {}
    for course_index, local_candidates in candidates.items():
        if not local_candidates:
            continue
        normalized = [_compact(candidate.value) for candidate in local_candidates]
        winner, winner_count = Counter(normalized).most_common(1)[0]
        consensus_counts[course_index] = winner_count
        if winner_count < 2:
            continue

        _, original = prepared_by_index[course_index]
        original_text = _compact(original.value)
        if winner == original_text:
            continue
        similarity = SequenceMatcher(None, original_text, winner).ratio()
        if similarity < 0.72:
            continue

        winning_candidates = [
            candidate for candidate in local_candidates if _compact(candidate.value) == winner
        ]
        selected = max(winning_candidates, key=lambda candidate: candidate.confidence or 0.0)
        previous_raw = original.raw_text or original_text
        selected_raw = selected.raw_text or winner
        original.value = winner
        original.status = "review"
        original.confidence = selected.confidence
        original.raw_text = f"整图 OCR：{previous_raw}；局部放大复识别：{selected_raw}"
        refinement_reason = "局部高分辨率复识别至少两种图像版本一致，采用局部结果，仍需人工确认"
        original.reason = (
            f"{original.reason}；{refinement_reason}"
            if original.reason
            else refinement_reason
        )
        changed_indexes.append(course_index)

    return {
        "attemptedCourseCount": len(prepared),
        "changedCourseCount": len(changed_indexes),
        "changedCourseIndexes": changed_indexes,
        "localConsensusCounts": consensus_counts,
        "predictCallCount": 1,
        "contactSheet": {
            "width": sheet_width,
            "height": sheet_height,
            "variantCount": variant_count,
        },
    }
