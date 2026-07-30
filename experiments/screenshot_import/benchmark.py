from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .models import CourseBlock, OcrToken, PixelBox

EVALUATED_FIELDS = (
    "weekday",
    "startSection",
    "endSection",
    "name",
    "teacher",
    "location",
    "weeks",
    "parity",
)


def validate_confidence_thresholds(review_confidence: float, high_confidence: float) -> None:
    if not 0.0 <= review_confidence <= high_confidence <= 1.0:
        raise ValueError(
            "confidence thresholds must satisfy "
            "0 <= review-confidence <= high-confidence <= 1"
        )


def validate_overlap_threshold(value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError("assignment-overlap-threshold must be between 0 and 1")


def _intersection_area(left: PixelBox, right: PixelBox) -> float:
    width = max(0.0, min(left.right, right.right) - max(left.x, right.x))
    height = max(0.0, min(left.bottom, right.bottom) - max(left.y, right.y))
    return width * height


def _contains(box: PixelBox, point: tuple[float, float]) -> bool:
    x, y = point
    return box.x <= x <= box.right and box.y <= y <= box.bottom


@dataclass(frozen=True)
class AmbiguousToken:
    token: OcrToken
    candidate_block_indices: tuple[int, ...]
    reason: str


@dataclass
class TokenAssignmentResult:
    by_block: list[list[OcrToken]]
    ambiguous: list[AmbiguousToken] = field(default_factory=list)
    unassigned: list[OcrToken] = field(default_factory=list)

    def debug_dict(self, image_width: int, image_height: int) -> dict[str, Any]:
        return {
            "assignedCounts": [len(tokens) for tokens in self.by_block],
            "ambiguous": [
                {
                    "token": item.token.to_dict(image_width, image_height),
                    "candidateBlockIndices": list(item.candidate_block_indices),
                    "reason": item.reason,
                }
                for item in self.ambiguous
            ],
            "unassigned": [
                token.to_dict(image_width, image_height) for token in self.unassigned
            ],
        }


def assign_tokens_to_blocks(
    tokens: Iterable[OcrToken],
    blocks: list[CourseBlock],
    *,
    overlap_threshold: float = 0.35,
) -> TokenAssignmentResult:
    validate_overlap_threshold(overlap_threshold)
    result = TokenAssignmentResult(by_block=[[] for _ in blocks])
    for token in tokens:
        center_matches = [
            index
            for index, block in enumerate(blocks)
            if _contains(block.original_box, token.box.center)
        ]
        if len(center_matches) == 1:
            result.by_block[center_matches[0]].append(token)
            continue
        if len(center_matches) > 1:
            result.ambiguous.append(
                AmbiguousToken(token, tuple(center_matches), "token center matches multiple blocks")
            )
            continue

        token_area = max(1.0, token.box.width * token.box.height)
        overlap_matches = [
            index
            for index, block in enumerate(blocks)
            if _intersection_area(token.box, block.original_box) / token_area
            >= overlap_threshold
        ]
        if len(overlap_matches) == 1:
            result.by_block[overlap_matches[0]].append(token)
        elif len(overlap_matches) > 1:
            result.ambiguous.append(
                AmbiguousToken(
                    token,
                    tuple(overlap_matches),
                    "token overlap exceeds threshold for multiple blocks",
                )
            )
        else:
            result.unassigned.append(token)

    for block_tokens in result.by_block:
        block_tokens.sort(key=lambda token: (token.box.y, token.box.x))
    return result


def load_ground_truth(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("courses"), list):
        raise ValueError("ground truth must contain a courses list")
    return payload


def _normalize_text(value: Any) -> str:
    return re.sub(r"[\s，,。；;：:（）()\-—_]+", "", "" if value is None else str(value)).lower()


def _normalized(field_name: str, value: Any) -> Any:
    if field_name == "weeks":
        try:
            return tuple(sorted(int(item) for item in (value or [])))
        except (TypeError, ValueError):
            return ()
    if field_name in {"weekday", "startSection", "endSection"}:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if field_name == "parity":
        return str(value or "").lower()
    return _normalize_text(value)


def _review_status(course: dict[str, Any], field_name: str) -> str:
    review = course.get("review") if isinstance(course, dict) else None
    fields = review.get("fields") if isinstance(review, dict) else None
    if isinstance(fields, list):
        for item in fields:
            if isinstance(item, dict) and item.get("field") == field_name:
                return str(item.get("status", "review"))
    return "missing" if course.get(field_name) in (None, "", []) else "review"


def _match_courses(
    truth_courses: list[dict[str, Any]], predicted_courses: list[dict[str, Any]]
) -> list[dict[str, Any] | None]:
    remaining = set(range(len(predicted_courses)))
    matches: list[dict[str, Any] | None] = []
    for truth in truth_courses:
        best_index: int | None = None
        best_score = -1
        for index in remaining:
            predicted = predicted_courses[index]
            score = sum(
                _normalized(field_name, predicted.get(field_name))
                == _normalized(field_name, truth.get(field_name))
                for field_name in ("weekday", "startSection", "endSection", "name")
            )
            if score > best_score:
                best_score = score
                best_index = index
        if best_index is None or best_score <= 0:
            matches.append(None)
        else:
            remaining.remove(best_index)
            matches.append(predicted_courses[best_index])
    return matches


def evaluate_draft(draft: dict[str, Any], ground_truth: dict[str, Any]) -> dict[str, Any]:
    truth_courses = [item for item in ground_truth.get("courses", []) if isinstance(item, dict)]
    predicted_courses = [item for item in draft.get("courses", []) if isinstance(item, dict)]
    matches = _match_courses(truth_courses, predicted_courses)
    confusion = {
        "correctConfirmed": 0,
        "wrongConfirmed": 0,
        "correctReview": 0,
        "wrongReview": 0,
        "missing": 0,
    }
    counts = {
        "fieldTotal": 0,
        "exactlyCorrect": 0,
        "normalizedCorrect": 0,
        "wrong": 0,
        "missing": 0,
        "confirmed": 0,
        "review": 0,
    }
    details: list[dict[str, Any]] = []
    auto_errors: list[dict[str, Any]] = []

    for course_index, (truth, predicted) in enumerate(zip(truth_courses, matches)):
        for field_name in EVALUATED_FIELDS:
            counts["fieldTotal"] += 1
            expected = truth.get(field_name)
            if predicted is None:
                status = "missing"
                actual = None
            else:
                status = _review_status(predicted, field_name)
                actual = predicted.get(field_name)
            exact = predicted is not None and actual == expected
            normalized = (
                predicted is not None
                and not exact
                and _normalized(field_name, actual) == _normalized(field_name, expected)
            )
            correct = exact or normalized

            if exact:
                counts["exactlyCorrect"] += 1
            elif normalized:
                counts["normalizedCorrect"] += 1
            elif status == "missing":
                counts["missing"] += 1
            else:
                counts["wrong"] += 1

            if status == "confirmed":
                counts["confirmed"] += 1
                bucket = "correctConfirmed" if correct else "wrongConfirmed"
            elif status == "missing":
                bucket = "missing"
            else:
                counts["review"] += 1
                bucket = "correctReview" if correct else "wrongReview"
            confusion[bucket] += 1

            detail = {
                "courseIndex": course_index,
                "field": field_name,
                "expected": expected,
                "actual": actual,
                "status": status,
                "exact": exact,
                "normalizedCorrect": normalized,
                "classification": bucket,
            }
            details.append(detail)
            if bucket == "wrongConfirmed":
                auto_errors.append(detail)

    confirmed_total = confusion["correctConfirmed"] + confusion["wrongConfirmed"]
    wrong_confirmed_rate = (
        confusion["wrongConfirmed"] / confirmed_total if confirmed_total else None
    )
    return {
        "groundTruthSource": ground_truth.get("source"),
        "courseCountExpected": len(truth_courses),
        "courseCountPredicted": len(predicted_courses),
        "counts": counts,
        "confusion": confusion,
        "autoConfirmationErrors": auto_errors,
        "wrongConfirmedRate": wrong_confirmed_rate,
        "fields": details,
    }


def enforce_image_parity_review(fields: dict[str, Any]) -> None:
    parity = fields.get("parity")
    if parity is None:
        return
    if getattr(parity, "value", None) == "all" and getattr(parity, "status", None) == "confirmed":
        parity.status = "review"
        reason = "图片来源未识别到明确单双周标记，不能自动确认每周"
        existing = getattr(parity, "reason", None)
        parity.reason = f"{existing}；{reason}" if existing else reason


def finite_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
