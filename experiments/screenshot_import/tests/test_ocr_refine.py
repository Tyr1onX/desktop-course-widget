from __future__ import annotations

import numpy as np

from experiments.screenshot_import.models import CourseBlock, OcrToken, ParsedField, PixelBox
from experiments.screenshot_import.ocr import OcrEngine
from experiments.screenshot_import.ocr_refine import refine_location_fields


class ConsensusEngine(OcrEngine):
    def __init__(self, texts: list[str]):
        self.texts = texts
        self.calls = 0

    def recognize(self, image_bgr: np.ndarray, region: PixelBox) -> list[OcrToken]:
        del region
        self.calls += 1
        height, width = image_bgr.shape[:2]
        centers = [width * 0.15, width * 0.50, width * 0.85]
        return [
            OcrToken(
                text=text,
                confidence=0.98,
                box=PixelBox(center - 80.0, height / 2.0 - 12.0, 160.0, 24.0),
            )
            for center, text in zip(centers, self.texts)
        ]

    def version_info(self) -> dict[str, str]:
        return {"engine": "consensus-test"}


def course_with_location(value: str = "节湖-第1教学楼-四阶") -> tuple[CourseBlock, dict[str, ParsedField]]:
    box = PixelBox(20.0, 20.0, 180.0, 24.0)
    block = CourseBlock(
        weekday=1,
        start_section=1,
        end_section=2,
        working_box=box,
        original_box=box,
        confidence=0.96,
    )
    fields = {
        "location": ParsedField(
            field="location",
            value=value,
            status="review",
            confidence=0.99,
            raw_text=value,
            box=box,
            reason="OCR 文字字段需人工确认",
        )
    }
    return block, fields


def test_two_local_variants_replace_a_stable_whole_image_character_error() -> None:
    engine = ConsensusEngine([
        "南湖-第1教学楼-四阶",
        "南湖-第1教学楼-四阶",
        "节湖-第1教学楼-四阶",
    ])
    course = course_with_location()
    result = refine_location_fields(
        np.full((100, 260, 3), 255, dtype=np.uint8),
        engine,
        [course],
    )

    location = course[1]["location"]
    assert engine.calls == 1
    assert result["predictCallCount"] == 1
    assert result["changedCourseIndexes"] == [0]
    assert location.value == "南湖-第1教学楼-四阶"
    assert location.status == "review"
    assert "整图 OCR：节湖" in (location.raw_text or "")
    assert "局部放大复识别：南湖" in (location.raw_text or "")
    assert "至少两种图像版本一致" in (location.reason or "")


def test_disagreeing_local_variants_do_not_override_the_whole_image_result() -> None:
    engine = ConsensusEngine([
        "南湖-第1教学楼-四阶",
        "节湖-第1教学楼-四阶",
        "北湖-第1教学楼-四阶",
    ])
    course = course_with_location()
    result = refine_location_fields(
        np.full((100, 260, 3), 255, dtype=np.uint8),
        engine,
        [course],
    )

    assert engine.calls == 1
    assert result["changedCourseCount"] == 0
    assert course[1]["location"].value == "节湖-第1教学楼-四阶"


def test_missing_location_box_skips_the_additional_ocr_call() -> None:
    engine = ConsensusEngine(["南湖-第1教学楼-四阶"] * 3)
    block, fields = course_with_location()
    fields["location"].box = None
    result = refine_location_fields(
        np.full((100, 260, 3), 255, dtype=np.uint8),
        engine,
        [(block, fields)],
    )

    assert engine.calls == 0
    assert result["predictCallCount"] == 0
    assert result["attemptedCourseCount"] == 0
