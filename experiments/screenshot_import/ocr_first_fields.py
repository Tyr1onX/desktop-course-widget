from __future__ import annotations

import re

from .models import CourseBlock, OcrToken, ParsedField
from .parse_fields import (
    FieldParserConfig,
    group_tokens_into_lines,
    normalize_text,
    parse_course_fields,
    parse_week_expression,
)

_WEEK_EXPR = re.compile(
    r"(?:第\s*)?[0-9\s,，、;；~～至\-—–－]+?\s*周(?:\s*[（(]?[单双]\s*[）)]?)?"
)
_SCHEDULE_TIME = re.compile(
    r"(?:星期|礼拜|周)\s*[一二三四五六日天1-7]\s*第\s*\d{1,2}(?:\s*[,，、.]\s*\d{1,2}|\s*节)"
)
_TRUNCATED_WEEK_RANGE = re.compile(
    r"[（({]\s*(?:第\s*)?(\d{1,2})\s*[-~～至]\s*(\d{1,2})(?=\s*(?:[）)}]|$))"
)
_LOCATION_HINT = re.compile(
    r"(?:校区|教学楼|实验楼|综合楼|逸夫楼|楼|馆|教室|实验室|室|中心|基地|园区)"
)
_ROOM_ONLY = re.compile(r"^[A-Za-z]?\d{2,5}[A-Za-z]?$")
_ROOM_CODE = re.compile(r"^[\u4e00-\u9fff]{1,4}\d{1,3}-\d{1,4}[A-Za-z]?$")
_SECTION_PREFIX = re.compile(
    r"^.*?(?:第\s*)?\d{1,2}\s*节"
    r"(?:\s*[-~～至]\s*(?:第\s*)?\d{1,2}\s*节)?\s*[,，、;；:：-]*"
)
_OCR_TEXT_FIELDS = ("name", "teacher", "location", "weeks", "parity")


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value))


def _is_location_candidate(value: str) -> bool:
    return bool(
        _ROOM_ONLY.fullmatch(value)
        or _ROOM_CODE.fullmatch(value)
        or (_LOCATION_HINT.search(value) and 2 <= len(value) <= 40)
    )


def _location_from_line(value: str) -> str | None:
    """Extract only the location portion from a possibly combined OCR line.

    Timetable screenshots commonly place week, weekday, section, and location on
    one visual line. OCR may preserve a separator (for example
    ``第3节-第4节,南湖-教学楼``) or merge the two portions. The parser must not
    promote the remaining ``节`` or the whole schedule expression into the
    location field.
    """

    compact = _compact(value)
    compact = re.sub(r"^(?:地点|教室)[:：]?", "", compact)
    if _is_location_candidate(compact):
        return compact

    # Prefer a complete comma-separated suffix. normalize_text has already
    # converted common Chinese separators to commas.
    segments = [
        segment.strip("-,:：")
        for segment in compact.split(",")
        if segment.strip("-,:：")
    ]
    for segment in reversed(segments):
        if _is_location_candidate(segment):
            return segment

    # OCR sometimes drops the separator and joins the location directly after
    # the section range. Strip the complete section prefix rather than a literal
    # word or campus-specific phrase.
    without_schedule = _SECTION_PREFIX.sub("", compact, count=1).strip("-,:：")
    if without_schedule != compact and _is_location_candidate(without_schedule):
        return without_schedule
    return None


def enforce_ocr_first_text_review(fields: dict[str, ParsedField]) -> None:
    """Keep OCR-derived content as review evidence, regardless of confidence.

    OCR confidence is useful diagnostic information, but it cannot stand in for
    a comparison with the source image.  Weekday and section are structural
    fields handled by the spatial discovery stage; every text-derived field is
    deliberately left for human review.
    """
    for field_name in _OCR_TEXT_FIELDS:
        field = fields.get(field_name)
        if field is None or field.status != "confirmed":
            continue
        field.status = "review"
        field.reason = (
            f"{field.reason}；OCR 文字字段需人工确认"
            if field.reason
            else "OCR 文字字段需人工确认"
        )


def _week_expression_from_line(text: str) -> tuple[str, bool] | None:
    """Return a parseable week expression and whether its unit was inferred.

    A common OCR failure keeps a parenthesized range after an otherwise explicit
    weekday/section expression but drops its terminal ``周``.  It is safe to
    recover that range only as review evidence: the surrounding time text
    prevents weekday and section digits from being included in the range.
    """
    normalized = normalize_text(text)
    match = _WEEK_EXPR.search(normalized)
    if match:
        return match.group(0), False
    if not _SCHEDULE_TIME.search(normalized):
        return None
    truncated = _TRUNCATED_WEEK_RANGE.search(normalized)
    if not truncated:
        return None
    return f"第{truncated.group(1)}-{truncated.group(2)}周", True


def parse_ocr_first_course_fields(
    tokens: list[OcrToken],
    block: CourseBlock,
    config: FieldParserConfig | None = None,
) -> dict[str, ParsedField]:
    config = config or FieldParserConfig()
    fields = parse_course_fields(tokens, block, config)
    lines = group_tokens_into_lines(tokens)

    for line in lines:
        expression = _week_expression_from_line(line.text)
        if not expression:
            continue
        week_text, inferred_unit = expression
        try:
            weeks, parity = parse_week_expression(week_text, config.maximum_week)
        except ValueError as error:
            fields["weeks"] = ParsedField(
                "weeks", [1], "review", line.confidence, line.text, line.box, str(error)
            )
            fields["parity"] = ParsedField(
                "parity", "all", "review", line.confidence, line.text, line.box,
                "教学周解析失败，单双周需要复核",
            )
        else:
            status = (
                "review"
                if inferred_unit
                else "confirmed" if line.confidence >= config.high_confidence else "review"
            )
            reason = (
                "OCR 未识别教学周单位；由紧邻课程时间后的括号范围推断，需要复核"
                if inferred_unit
                else None
            )
            fields["weeks"] = ParsedField(
                "weeks", weeks, status, line.confidence, line.text, line.box, reason
            )
            fields["parity"] = ParsedField(
                "parity", parity, status, line.confidence, line.text, line.box,
                reason or ("未发现单双周标记，按每周解释" if parity == "all" else None),
            )
        break

    for line in lines:
        location = _location_from_line(line.text)
        if location is not None:
            status = "confirmed" if line.confidence >= config.high_confidence else "review"
            fields["location"] = ParsedField(
                "location", location, status, line.confidence, line.text, line.box
            )
            break
    return fields
