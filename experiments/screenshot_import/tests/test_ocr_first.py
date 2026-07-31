from __future__ import annotations

from experiments.screenshot_import.models import CourseBlock, OcrToken, PixelBox
from experiments.screenshot_import.ocr_first import (
    discover_ocr_first_courses,
    parse_sections_from_text,
    parse_weekday_from_text,
)
from experiments.screenshot_import.ocr_first_fields import (
    enforce_ocr_first_text_review,
    parse_ocr_first_course_fields,
)


def token(text: str, x: float, y: float, width: float = 100, height: float = 20) -> OcrToken:
    return OcrToken(text=text, confidence=0.98, box=PixelBox(x, y, width, height))


def headers_and_sections() -> list[OcrToken]:
    tokens = [
        token(text, 200 + index * 100, 80, 70)
        for index, text in enumerate(
            ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
        )
    ]
    tokens.extend(
        token(str(section), 100, 130 + section * 60, 30, 18)
        for section in range(1, 9)
    )
    return tokens


def test_combined_time_text_is_parsed_without_template_branch():
    colored = "第3-8周,星期1,第1节-第2节"
    table = "周三第3,4节(第1-17周)"
    assert parse_weekday_from_text(colored) == 1
    assert parse_sections_from_text(colored) == (1, 2)
    assert parse_weekday_from_text(table) == 3
    assert parse_sections_from_text(table) == (3, 4)


def test_section_parser_does_not_treat_the_weekday_number_as_a_section():
    assert parse_sections_from_text("星期1,第3节-第4") == (3, 4)
    assert parse_sections_from_text("周五第3.4节") == (3, 4)
    assert parse_sections_from_text("周五第10,11,12节") == (10, 12)


def test_missing_week_suffix_after_an_explicit_time_is_a_reviewable_week_range():
    block = CourseBlock(1, 1, 2, PixelBox(0, 0, 80, 30), PixelBox(0, 0, 80, 30), 0.9)
    fields = parse_ocr_first_course_fields(
        [token("周一第1,2节{第1-17", 10, 10, 170)], block
    )

    assert fields["weeks"].value == list(range(1, 18))
    assert fields["weeks"].status == "review"
    assert "周单位" in (fields["weeks"].reason or "")


def test_location_excludes_section_tail_from_combined_ocr_lines():
    block = CourseBlock(1, 3, 4, PixelBox(0, 0, 220, 80), PixelBox(0, 0, 220, 80), 0.94)
    variants = [
        "3-10周,星期1,第3节-第4节,南湖-第一教学楼-四阶",
        "节,南湖-第一教学楼-四阶",
        "第3节-第4节南湖-第一教学楼-四阶",
    ]

    for raw_text in variants:
        fields = parse_ocr_first_course_fields(
            [
                token("信息论[04]", 10, 10, 100),
                token(raw_text, 10, 40, 260),
            ],
            block,
        )
        assert fields["location"].value == "南湖-第一教学楼-四阶"


def test_ocr_first_discovers_colored_and_black_table_courses_from_text_and_coordinates():
    tokens = headers_and_sections()
    tokens.extend(
        [
            token("通信与网络", 210, 155),
            token("张老师", 210, 180),
            token("第1-17周,星期1,第1节-第2节", 210, 205, 190),
            token("教学楼A101", 210, 230, 120),
            token("服务机器人", 410, 275),
            token("李老师", 410, 300),
            token("周三第3,4节(第1-17周)", 410, 325, 190),
            token("实验楼203", 410, 350, 120),
        ]
    )

    result = discover_ocr_first_courses(tokens, image_width=1000, image_height=800)
    assert len(result.blocks) == 2
    assert [
        (block.weekday, block.start_section, block.end_section)
        for block in result.blocks
    ] == [(1, 1, 2), (3, 3, 4)]

    first = parse_ocr_first_course_fields(result.tokens_by_block[0], result.blocks[0])
    second = parse_ocr_first_course_fields(result.tokens_by_block[1], result.blocks[1])
    assert first["name"].value == "通信与网络"
    assert first["location"].value == "教学楼A101"
    assert first["weeks"].value == list(range(1, 18))
    assert second["name"].value == "服务机器人"
    assert second["location"].value == "实验楼203"
    assert second["weeks"].value == list(range(1, 18))

    enforce_ocr_first_text_review(first)
    enforce_ocr_first_text_review(second)
    for fields in (first, second):
        for field_name in ("name", "teacher", "location", "weeks", "parity"):
            assert fields[field_name].status != "confirmed"
        assert "人工确认" in (fields["location"].reason or "")


def test_split_time_tokens_on_one_visual_line_do_not_create_duplicate_courses():
    tokens = headers_and_sections()
    tokens.extend(
        [
            token("服务机器人", 410, 275),
            token("李老师", 410, 300),
            token("周三", 410, 325, 45),
            token("第3,4节(第1-17周)", 460, 325, 150),
            token("实验楼203", 410, 350, 120),
        ]
    )
    result = discover_ocr_first_courses(tokens, image_width=1000, image_height=800)
    assert len(result.blocks) == 1
    assert (
        result.blocks[0].weekday,
        result.blocks[0].start_section,
        result.blocks[0].end_section,
    ) == (3, 3, 4)


def test_same_slot_on_distinct_rows_is_not_coalesced():
    tokens = headers_and_sections()
    tokens.extend(
        [
            token("周三第3,4节(第1-8周单周)", 410, 300, 200),
            token("周三第3,4节(第2-8周双周)", 410, 350, 200),
        ]
    )
    result = discover_ocr_first_courses(tokens, image_width=1000, image_height=800)
    assert len(result.blocks) == 2


def test_layout_excludes_text_below_last_section_row():
    tokens = headers_and_sections()
    tokens.extend(
        [
            token("课程A", 210, 155),
            token("星期1第1-2节第1-8周", 210, 180, 180),
            token("实验安排第1-2周星期1第1-2节", 210, 720, 220),
        ]
    )
    result = discover_ocr_first_courses(tokens, image_width=1000, image_height=900)
    assert len(result.blocks) == 1
    assert result.table_box is not None
    assert result.table_box.bottom < 720
