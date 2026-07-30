from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import CourseBlock, ParsedField

FIELD_ORDER = [
    "name", "teacher", "weekday", "startSection", "endSection", "weeks", "parity", "location"
]


def build_import_draft(
    *,
    source_path: str | Path,
    image_width: int,
    image_height: int,
    grid_confidence: float,
    section_rows: int,
    courses: list[tuple[CourseBlock, dict[str, ParsedField]]],
    recognizer_version: str,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    mapped_courses: list[dict[str, Any]] = []
    for block, fields in courses:
        evidence = [fields[name].evidence_dict(image_width, image_height) for name in FIELD_ORDER]
        mapped_courses.append(
            {
                "code": None,
                "name": str(fields["name"].value),
                "teacher": str(fields["teacher"].value) or None,
                "weekday": int(fields["weekday"].value),
                "startSection": int(fields["startSection"].value),
                "endSection": int(fields["endSection"].value),
                "weeks": [int(value) for value in fields["weeks"].value],
                "parity": str(fields["parity"].value),
                "location": str(fields["location"].value) or None,
                "review": {
                    "sourceBox": block.original_box.normalized(image_width, image_height),
                    "fields": evidence,
                },
            }
        )

    highest_week = max((week for item in mapped_courses for week in item["weeks"]), default=0)
    location_count = sum(1 for item in mapped_courses if item.get("location"))
    source = Path(source_path)
    return {
        "schemaVersion": 1,
        "source": "image",
        "sourceName": source.name,
        "suggestedName": source.stem or "截图课表",
        "detectedTermText": None,
        "summary": {
            "arrangements": len(mapped_courses),
            "highestWeek": highest_week,
            "locationCount": location_count,
        },
        "warnings": list(warnings or []),
        "courses": mapped_courses,
        "imageSource": {
            "width": image_width,
            "height": image_height,
            "weekdayColumns": 7,
            "sectionRows": section_rows,
            "recognizerVersion": recognizer_version[:80],
        },
    }
