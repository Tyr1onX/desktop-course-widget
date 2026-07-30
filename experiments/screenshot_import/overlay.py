from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .models import CourseBlock, GridResult, ParsedField, PixelBox

COLORS = {
    "table": (255, 0, 255),
    "weekday": (255, 160, 0),
    "section": (120, 120, 120),
    "block": (0, 165, 255),
    "confirmed": (40, 170, 50),
    "review": (0, 170, 255),
    "missing": (30, 30, 220),
}


def _rect(canvas: np.ndarray, box: PixelBox, color: tuple[int, int, int], thickness: int = 2) -> None:
    cv2.rectangle(
        canvas,
        (int(round(box.x)), int(round(box.y))),
        (int(round(box.right)), int(round(box.bottom))),
        color,
        thickness,
        cv2.LINE_AA,
    )


def draw_overlay(
    original_bgr: np.ndarray,
    grid: GridResult,
    courses: list[tuple[CourseBlock, dict[str, ParsedField]]],
    output_path: str | Path,
) -> None:
    canvas = original_bgr.copy()
    _rect(canvas, grid.original_table_box, COLORS["table"], 3)
    for box in grid.weekday_columns:
        _rect(canvas, box, COLORS["weekday"], 1)
    for box in grid.section_rows:
        _rect(canvas, box, COLORS["section"], 1)

    for index, (block, fields) in enumerate(courses, start=1):
        _rect(canvas, block.original_box, COLORS["block"], 3)
        statuses = [fields[name].status for name in fields]
        status = "missing" if "missing" in statuses else "review" if "review" in statuses else "confirmed"
        label = f"C{index} W{block.weekday} S{block.start_section}-{block.end_section} {status.upper()}"
        origin = (int(block.original_box.x + 3), max(16, int(block.original_box.y - 5)))
        cv2.putText(canvas, label, origin, cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLORS[status], 1, cv2.LINE_AA)
        for field in fields.values():
            if field.box is not None:
                _rect(canvas, field.box, COLORS[field.status], 1)

    y = 20
    for name in ["table", "weekday", "section", "block", "confirmed", "review", "missing"]:
        cv2.line(canvas, (10, y), (32, y), COLORS[name], 3)
        cv2.putText(canvas, name, (38, y + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.42, COLORS[name], 1, cv2.LINE_AA)
        y += 18
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output_path), canvas):
        raise RuntimeError(f"could not write overlay: {output_path}")
