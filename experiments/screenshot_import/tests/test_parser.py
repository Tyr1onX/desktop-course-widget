from __future__ import annotations

import pytest

from experiments.screenshot_import.models import CourseBlock, OcrToken, PixelBox
from experiments.screenshot_import.parse_fields import FieldParserConfig, parse_course_fields, parse_week_expression


def block() -> CourseBlock:
    box = PixelBox(100, 100, 200, 140)
    return CourseBlock(weekday=2, start_section=3, end_section=4, working_box=box, original_box=box, confidence=0.96)


def tokens(*values: tuple[str, float]) -> list[OcrToken]:
    return [OcrToken(text=text, confidence=confidence, box=PixelBox(110, 110 + index * 25, 150, 20)) for index, (text, confidence) in enumerate(values)]


@pytest.mark.parametrize(
    ("text", "weeks", "parity"),
    [
        ("1-8周", list(range(1, 9)), "all"),
        ("1-8,10-16周", list(range(1, 9)) + list(range(10, 17)), "all"),
        ("第1-8周", list(range(1, 9)), "all"),
        ("1-15周(单)", list(range(1, 16)), "odd"),
        ("1-16周(双)", list(range(1, 17)), "even"),
        ("1 - 8 周（单）", list(range(1, 9)), "odd"),
    ],
)
def test_week_rules(text: str, weeks: list[int], parity: str):
    assert parse_week_expression(text) == (weeks, parity)


@pytest.mark.parametrize("text", ["0-8周", "8-3周", "1-31周", "一到八周"])
def test_invalid_weeks_are_rejected(text: str):
    with pytest.raises(ValueError):
        parse_week_expression(text)


def test_teacher_and_location_order_changes():
    first = parse_course_fields(tokens(("通信原理", 0.96), ("张老师", 0.97), ("A101", 0.98), ("1-8周", 0.97)), block())
    second = parse_course_fields(tokens(("通信原理", 0.96), ("逸夫楼203", 0.98), ("李明", 0.91), ("1-8周", 0.97)), block())
    assert first["name"].value == "通信原理"
    assert first["teacher"].value == "张老师"
    assert first["location"].value == "A101"
    assert second["location"].value == "逸夫楼203"
    assert second["teacher"].value == "李明"
    assert second["teacher"].status == "review"


def test_missing_location_is_explicit():
    fields = parse_course_fields(tokens(("信息论", 0.97), ("1-8周", 0.96), ("张老师", 0.95)), block())
    assert fields["location"].status == "missing"
    assert fields["location"].value == ""


def test_low_confidence_and_missing_name_are_not_silently_confirmed():
    low = parse_course_fields(tokens(("通信原理", 0.61), ("1-8周", 0.96)), block(), FieldParserConfig())
    missing = parse_course_fields(tokens(("1-8周", 0.96), ("A101", 0.96)), block())
    assert low["name"].status == "review"
    assert missing["name"].status == "missing"
    assert missing["name"].value == "未识别课程"
