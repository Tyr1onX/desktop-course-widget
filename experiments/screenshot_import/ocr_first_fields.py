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
_LOCATION_HINT = re.compile(
    r"(?:校区|教学楼|实验楼|综合楼|逸夫楼|楼|馆|教室|实验室|室|中心|基地|园区)"
)
_ROOM_ONLY = re.compile(r"^[A-Za-z]?\d{2,5}[A-Za-z]?$")


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value))


def parse_ocr_first_course_fields(
    tokens: list[OcrToken],
    block: CourseBlock,
    config: FieldParserConfig | None = None,
) -> dict[str, ParsedField]:
    config = config or FieldParserConfig()
    fields = parse_course_fields(tokens, block, config)
    lines = group_tokens_into_lines(tokens)

    for line in lines:
        match = _WEEK_EXPR.search(normalize_text(line.text))
        if not match:
            continue
        try:
            weeks, parity = parse_week_expression(match.group(0), config.maximum_week)
        except ValueError as error:
            fields["weeks"] = ParsedField(
                "weeks", [1], "review", line.confidence, line.text, line.box, str(error)
            )
            fields["parity"] = ParsedField(
                "parity", "all", "review", line.confidence, line.text, line.box,
                "教学周解析失败，单双周需要复核",
            )
        else:
            status = "confirmed" if line.confidence >= config.high_confidence else "review"
            fields["weeks"] = ParsedField(
                "weeks", weeks, status, line.confidence, line.text, line.box
            )
            fields["parity"] = ParsedField(
                "parity", parity, status, line.confidence, line.text, line.box,
                "未发现单双周标记，按每周解释" if parity == "all" else None,
            )
        break

    for line in lines:
        compact = _compact(line.text)
        compact = re.sub(r"^(?:地点|教室)[:：]?", "", compact)
        if _ROOM_ONLY.fullmatch(compact) or (
            _LOCATION_HINT.search(compact) and 2 <= len(compact) <= 40
        ):
            status = "confirmed" if line.confidence >= config.high_confidence else "review"
            fields["location"] = ParsedField(
                "location", compact, status, line.confidence, line.text, line.box
            )
            break
    return fields
