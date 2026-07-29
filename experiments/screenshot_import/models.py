from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np


@dataclass(frozen=True)
class PixelBox:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def center(self) -> tuple[float, float]:
        return (self.x + self.width / 2.0, self.y + self.height / 2.0)

    def clipped(self, width: int, height: int) -> "PixelBox":
        x1 = min(max(self.x, 0.0), float(width))
        y1 = min(max(self.y, 0.0), float(height))
        x2 = min(max(self.right, x1), float(width))
        y2 = min(max(self.bottom, y1), float(height))
        return PixelBox(x1, y1, x2 - x1, y2 - y1)

    def normalized(self, width: int, height: int) -> dict[str, float]:
        if width <= 0 or height <= 0:
            raise ValueError("image dimensions must be positive")
        clipped = self.clipped(width, height)
        return {
            "x": round(clipped.x / width, 6),
            "y": round(clipped.y / height, 6),
            "width": round(clipped.width / width, 6),
            "height": round(clipped.height / height, 6),
        }

    def to_dict(self) -> dict[str, float]:
        return {
            "x": round(self.x, 3),
            "y": round(self.y, 3),
            "width": round(self.width, 3),
            "height": round(self.height, 3),
        }

    @staticmethod
    def union(boxes: Iterable["PixelBox"]) -> "PixelBox | None":
        values = list(boxes)
        if not values:
            return None
        x1 = min(box.x for box in values)
        y1 = min(box.y for box in values)
        x2 = max(box.right for box in values)
        y2 = max(box.bottom for box in values)
        return PixelBox(x1, y1, x2 - x1, y2 - y1)


@dataclass
class PreprocessedImage:
    original_bgr: np.ndarray
    working_bgr: np.ndarray
    gray: np.ndarray
    binary: np.ndarray
    transform: np.ndarray
    inverse_transform: np.ndarray
    original_width: int
    original_height: int
    applied_scale: float
    deskew_angle: float
    warnings: list[str] = field(default_factory=list)


@dataclass
class GridCell:
    weekday: int
    section: int
    working_box: PixelBox
    original_box: PixelBox

    def to_dict(self, image_width: int, image_height: int) -> dict[str, Any]:
        return {
            "weekday": self.weekday,
            "section": self.section,
            "box": self.original_box.to_dict(),
            "normalizedBox": self.original_box.normalized(image_width, image_height),
        }


@dataclass
class GridResult:
    working_table_box: PixelBox
    original_table_box: PixelBox
    working_vertical_lines: list[float]
    working_horizontal_lines: list[float]
    original_vertical_lines: list[float]
    original_horizontal_lines: list[float]
    weekday_columns: list[PixelBox]
    section_rows: list[PixelBox]
    cells: list[GridCell]
    confidence: float
    warnings: list[str]
    horizontal_mask: np.ndarray | None = None
    vertical_mask: np.ndarray | None = None

    @property
    def weekday_count(self) -> int:
        return len(self.weekday_columns)

    @property
    def section_count(self) -> int:
        return len(self.section_rows)

    def to_dict(self, image_width: int, image_height: int) -> dict[str, Any]:
        return {
            "tableBox": self.original_table_box.to_dict(),
            "tableBoxNormalized": self.original_table_box.normalized(image_width, image_height),
            "weekdayColumnCount": self.weekday_count,
            "sectionRowCount": self.section_count,
            "weekdayColumns": [
                {
                    "weekday": index + 1,
                    "box": box.to_dict(),
                    "normalizedBox": box.normalized(image_width, image_height),
                }
                for index, box in enumerate(self.weekday_columns)
            ],
            "sectionRows": [
                {
                    "section": index + 1,
                    "box": box.to_dict(),
                    "normalizedBox": box.normalized(image_width, image_height),
                }
                for index, box in enumerate(self.section_rows)
            ],
            "cells": [cell.to_dict(image_width, image_height) for cell in self.cells],
            "confidence": round(self.confidence, 6),
            "warnings": self.warnings,
        }


@dataclass
class CourseBlock:
    weekday: int
    start_section: int
    end_section: int
    working_box: PixelBox
    original_box: PixelBox
    confidence: float
    warnings: list[str] = field(default_factory=list)

    def to_dict(self, image_width: int, image_height: int) -> dict[str, Any]:
        return {
            "weekday": self.weekday,
            "startSection": self.start_section,
            "endSection": self.end_section,
            "box": self.original_box.to_dict(),
            "normalizedBox": self.original_box.normalized(image_width, image_height),
            "confidence": round(self.confidence, 6),
            "warnings": self.warnings,
        }


@dataclass
class OcrToken:
    text: str
    confidence: float
    box: PixelBox

    def to_dict(self, image_width: int, image_height: int) -> dict[str, Any]:
        return {
            "text": self.text,
            "confidence": round(float(self.confidence), 6),
            "box": self.box.to_dict(),
            "normalizedBox": self.box.normalized(image_width, image_height),
        }


@dataclass
class ParsedField:
    field: str
    value: Any
    status: str
    confidence: float | None = None
    raw_text: str | None = None
    box: PixelBox | None = None
    reason: str | None = None

    def evidence_dict(self, image_width: int, image_height: int) -> dict[str, Any]:
        evidence: dict[str, Any] = {
            "field": self.field,
            "status": self.status,
        }
        if self.confidence is not None:
            evidence["confidence"] = round(float(self.confidence), 6)
        if self.raw_text:
            evidence["rawText"] = self.raw_text[:500]
        if self.box is not None and self.box.width > 0 and self.box.height > 0:
            evidence["box"] = self.box.normalized(image_width, image_height)
        if self.reason:
            evidence["reason"] = self.reason[:500]
        return evidence


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    homogeneous = np.column_stack([points, np.ones(len(points), dtype=np.float64)])
    transformed = homogeneous @ matrix.T
    divisor = transformed[:, 2:3]
    divisor[np.isclose(divisor, 0.0)] = 1.0
    return transformed[:, :2] / divisor


def transform_box(box: PixelBox, matrix: np.ndarray) -> PixelBox:
    points = np.array(
        [
            [box.x, box.y],
            [box.right, box.y],
            [box.right, box.bottom],
            [box.x, box.bottom],
        ],
        dtype=np.float64,
    )
    transformed = transform_points(points, matrix)
    x1, y1 = transformed.min(axis=0)
    x2, y2 = transformed.max(axis=0)
    return PixelBox(float(x1), float(y1), float(x2 - x1), float(y2 - y1))
