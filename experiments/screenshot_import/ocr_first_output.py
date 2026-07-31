from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2

from .models import OcrToken, PixelBox


def write_ocr_first_outputs(
    *,
    output: Path,
    image: Any,
    image_width: int,
    image_height: int,
    table_box: PixelBox | None,
    course_results: list[Any],
    tokens: list[OcrToken],
    engine: dict[str, str],
    structure: dict[str, Any],
    draft: dict[str, Any],
) -> dict[str, str]:
    draft_path = output / "draft.json"
    grid_path = output / "grid.json"
    ocr_path = output / "ocr.json"
    overlay_path = output / "overlay.png"
    report_path = output / "report.json"
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    grid_path.write_text(json.dumps(structure, ensure_ascii=False, indent=2), encoding="utf-8")
    ocr_path.write_text(
        json.dumps(
            {
                "engine": engine,
                "ocrMode": "ocr-first",
                "tokens": [token.to_dict(image_width, image_height) for token in tokens],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    canvas = image.copy()
    if table_box:
        cv2.rectangle(
            canvas,
            (int(table_box.x), int(table_box.y)),
            (int(table_box.right), int(table_box.bottom)),
            (255, 0, 255),
            3,
        )
    for index, (block, fields) in enumerate(course_results, start=1):
        box = block.original_box
        cv2.rectangle(
            canvas,
            (int(box.x), int(box.y)),
            (int(box.right), int(box.bottom)),
            (0, 165, 255),
            2,
        )
        status = "review" if any(value.status != "confirmed" for value in fields.values()) else "confirmed"
        cv2.putText(
            canvas,
            f"C{index} W{block.weekday} S{block.start_section}-{block.end_section} {status}",
            (int(box.x + 2), max(16, int(box.y - 4))),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (0, 120, 255),
            1,
            cv2.LINE_AA,
        )
    if not cv2.imwrite(str(overlay_path), canvas):
        raise RuntimeError(f"could not write overlay: {overlay_path}")
    return {
        "draft": str(draft_path),
        "grid": str(grid_path),
        "ocr": str(ocr_path),
        "overlay": str(overlay_path),
        "report": str(report_path),
    }
