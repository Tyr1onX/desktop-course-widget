from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .course_evaluation import EVALUATED_FIELDS, evaluate_draft
from .models import CourseBlock, OcrToken, PixelBox


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
            if _intersection_area(token.box, block.original_box) / token_area >= overlap_threshold
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
