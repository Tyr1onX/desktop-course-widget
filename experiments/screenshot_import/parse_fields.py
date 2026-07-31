from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from .models import CourseBlock, OcrToken, ParsedField, PixelBox


@dataclass(frozen=True)
class FieldParserConfig:
    high_confidence: float = 0.90
    review_confidence: float = 0.55
    maximum_week: int = 30


@dataclass
class TextLine:
    text: str
    tokens: list[OcrToken]

    @property
    def confidence(self) -> float:
        if not self.tokens:
            return 0.0
        return float(sum(token.confidence for token in self.tokens) / len(self.tokens))

    @property
    def box(self) -> PixelBox | None:
        return PixelBox.union(token.box for token in self.tokens)


_CHINESE_NAME = re.compile(r"^[\u4e00-\u9fff]{2,4}$")
_TEACHER_EXPLICIT = re.compile(r"(?:教师|老师)\s*[:：]?\s*([\u4e00-\u9fff]{2,4})|([\u4e00-\u9fff]{1,4}老师)")
_LOCATION_PATTERNS = [
    re.compile(r"\b[A-Za-z]\s*\d{2,4}\b"),
    re.compile(r"[\u4e00-\u9fffA-Za-z]{1,14}(?:楼|馆|室|教室|实验室)\s*[A-Za-z]?\d{0,4}"),
    re.compile(r"(?:逸夫楼|教学楼|实验楼|综合楼)\s*[A-Za-z]?\d{1,4}"),
]
_WEEK_HINT = re.compile(r"(?:周|第\s*\d|\d\s*[-~～至]\s*\d|单周|双周|\(\s*[单双]\s*\)|（\s*[单双]\s*）)")
_PARITY_ODD = re.compile(r"(?:单周|\(\s*单\s*\)|（\s*单\s*）|(?<![\u4e00-\u9fff])单(?![\u4e00-\u9fff]))")
_PARITY_EVEN = re.compile(r"(?:双周|\(\s*双\s*\)|（\s*双\s*）|(?<![\u4e00-\u9fff])双(?![\u4e00-\u9fff]))")


def normalize_text(value: str) -> str:
    return (
        value.replace("，", ",")
        .replace("、", ",")
        .replace("；", ",")
        .replace(";", ",")
        .replace("：", ":")
        .replace("（", "(")
        .replace("）", ")")
        .replace("—", "-")
        .replace("–", "-")
        .replace("－", "-")
        .strip()
    )


def group_tokens_into_lines(tokens: Iterable[OcrToken]) -> list[TextLine]:
    ordered = sorted(tokens, key=lambda token: (token.box.center[1], token.box.x))
    lines: list[list[OcrToken]] = []
    for token in ordered:
        center_y = token.box.center[1]
        matched: list[OcrToken] | None = None
        for line in lines:
            line_box = PixelBox.union(item.box for item in line)
            assert line_box is not None
            tolerance = max(token.box.height, line_box.height) * 0.55
            if abs(center_y - line_box.center[1]) <= tolerance:
                matched = line
                break
        if matched is None:
            lines.append([token])
        else:
            matched.append(token)

    result: list[TextLine] = []
    for line in lines:
        line.sort(key=lambda token: token.box.x)
        text = " ".join(normalize_text(token.text) for token in line if token.text.strip()).strip()
        if text:
            result.append(TextLine(text=text, tokens=line))
    result.sort(key=lambda line: line.box.center[1] if line.box else 0.0)
    return result


def _status(
    confidence: float | None,
    config: FieldParserConfig,
    *,
    ambiguous: bool = False,
    missing: bool = False,
) -> tuple[str, str | None]:
    if missing:
        return "missing", "未识别到可用值"
    if ambiguous:
        return "review", "规则解析存在歧义"
    if confidence is None:
        return "review", "缺少置信度"
    if confidence >= config.high_confidence:
        return "confirmed", None
    if confidence >= config.review_confidence:
        return "review", f"置信度 {confidence:.2f} 低于自动确认阈值 {config.high_confidence:.2f}"
    return "review", f"置信度 {confidence:.2f} 低于实验可用阈值 {config.review_confidence:.2f}"


def _parse_weeks_text(value: str, maximum_week: int) -> tuple[list[int], str, str | None]:
    normalized = normalize_text(value)
    parity = "all"
    if _PARITY_ODD.search(normalized):
        parity = "odd"
    elif _PARITY_EVEN.search(normalized):
        parity = "even"

    cleaned = _PARITY_ODD.sub("", normalized)
    cleaned = _PARITY_EVEN.sub("", cleaned)
    cleaned = cleaned.replace("第", "").replace("周", "")
    cleaned = re.sub(r"[()\s]", "", cleaned)
    cleaned = re.sub(r"[^0-9,~～至-]", "", cleaned)
    if not cleaned:
        return [], parity, "未提取到教学周数字"

    weeks: set[int] = set()
    for segment in cleaned.split(","):
        if not segment:
            continue
        range_match = re.fullmatch(r"(\d{1,2})[-~～至](\d{1,2})", segment)
        if range_match:
            start = int(range_match.group(1))
            end = int(range_match.group(2))
            if start < 1 or end > maximum_week or start > end:
                return [], parity, f"教学周范围 {start}-{end} 不合法"
            weeks.update(range(start, end + 1))
            continue
        if re.fullmatch(r"\d{1,2}", segment):
            week = int(segment)
            if not 1 <= week <= maximum_week:
                return [], parity, f"教学周 {week} 超出 1～{maximum_week}"
            weeks.add(week)
            continue
        return [], parity, f"无法解析教学周片段“{segment}”"

    if not weeks:
        return [], parity, "未提取到合法教学周"
    return sorted(weeks), parity, None


def parse_week_expression(value: str, maximum_week: int = 30) -> tuple[list[int], str]:
    weeks, parity, error = _parse_weeks_text(value, maximum_week)
    if error:
        raise ValueError(error)
    return weeks, parity


def _extract_location(text: str) -> str | None:
    normalized = normalize_text(text)
    for pattern in _LOCATION_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return re.sub(r"\s+", "", match.group(0))
    return None


def _extract_teacher(text: str) -> tuple[str | None, bool]:
    normalized = normalize_text(text)
    match = _TEACHER_EXPLICIT.search(normalized)
    if match:
        value = match.group(1) or match.group(2)
        if match.group(1):
            value = f"{value}老师"
        return value, False
    stripped = re.sub(r"\s+", "", normalized)
    if _CHINESE_NAME.fullmatch(stripped):
        return stripped, True
    return None, False


def _field_from_line(
    field: str,
    value: object,
    line: TextLine,
    config: FieldParserConfig,
    *,
    ambiguous: bool = False,
    extra_reason: str | None = None,
) -> ParsedField:
    status, reason = _status(line.confidence, config, ambiguous=ambiguous)
    if extra_reason:
        reason = f"{reason}；{extra_reason}" if reason else extra_reason
        if status == "confirmed" and ambiguous:
            status = "review"
    return ParsedField(
        field=field,
        value=value,
        status=status,
        confidence=line.confidence,
        raw_text=line.text,
        box=line.box,
        reason=reason,
    )


def _missing(field: str, placeholder: object, reason: str) -> ParsedField:
    return ParsedField(
        field=field,
        value=placeholder,
        status="missing",
        confidence=None,
        raw_text=None,
        box=None,
        reason=reason,
    )


def _structural_field(
    field: str,
    value: int,
    block: CourseBlock,
    config: FieldParserConfig,
) -> ParsedField:
    ambiguous = bool(block.warnings)
    status, reason = _status(block.confidence, config, ambiguous=ambiguous)
    if block.warnings:
        warning_text = "；".join(block.warnings)
        reason = f"{reason}；{warning_text}" if reason else warning_text
    return ParsedField(
        field=field,
        value=value,
        status=status,
        confidence=block.confidence,
        raw_text="网格结构定位",
        box=block.original_box,
        reason=reason,
    )


def parse_course_fields(
    tokens: list[OcrToken],
    block: CourseBlock,
    config: FieldParserConfig | None = None,
) -> dict[str, ParsedField]:
    config = config or FieldParserConfig()
    lines = group_tokens_into_lines(tokens)

    week_line: TextLine | None = next((line for line in lines if _WEEK_HINT.search(line.text)), None)
    week_error: str | None = None
    weeks: list[int] = []
    parity = "all"
    if week_line:
        weeks, parity, week_error = _parse_weeks_text(week_line.text, config.maximum_week)

    location_line: TextLine | None = None
    location_value: str | None = None
    teacher_line: TextLine | None = None
    teacher_value: str | None = None
    teacher_ambiguous = False

    # Prefer explicit teacher markers. Bare 2-4 character Chinese lines are only
    # considered after the course-name candidate has been selected.
    for line in lines:
        if line is week_line:
            continue
        location = _extract_location(line.text)
        teacher, ambiguous = _extract_teacher(line.text)
        if location and location_line is None:
            location_line = line
            location_value = location
        if teacher and not ambiguous and teacher_line is None:
            teacher_line = line
            teacher_value = teacher

    reserved = {id(line) for line in [week_line, location_line, teacher_line] if line is not None}
    unclassified = [line for line in lines if id(line) not in reserved]
    name_line = unclassified[0] if unclassified else None

    if teacher_line is None and len(unclassified) > 1:
        for candidate in unclassified[1:]:
            teacher, ambiguous = _extract_teacher(candidate.text)
            if teacher:
                teacher_line = candidate
                teacher_value = teacher
                teacher_ambiguous = ambiguous
                break

    name_candidates = [
        line for line in unclassified
        if line is not teacher_line
    ]
    name_line = name_candidates[0] if name_candidates else None
    name_ambiguous = len(name_candidates) > 1

    fields: dict[str, ParsedField] = {
        "weekday": _structural_field("weekday", block.weekday, block, config),
        "startSection": _structural_field(
            "startSection", block.start_section, block, config
        ),
        "endSection": _structural_field("endSection", block.end_section, block, config),
    }

    if name_line:
        name_value = re.sub(r"\s+", "", name_line.text)
        fields["name"] = _field_from_line(
            "name",
            name_value,
            name_line,
            config,
            ambiguous=name_ambiguous,
            extra_reason=("存在多行未分类文本" if name_ambiguous else None),
        )
    else:
        fields["name"] = _missing("name", "未识别课程", "无法确定课程名称")

    if teacher_line and teacher_value:
        fields["teacher"] = _field_from_line(
            "teacher",
            teacher_value,
            teacher_line,
            config,
            ambiguous=teacher_ambiguous,
            extra_reason=("教师姓名没有“老师”后缀" if teacher_ambiguous else None),
        )
    else:
        fields["teacher"] = _missing("teacher", "", "未识别教师，可留空")

    if location_line and location_value:
        fields["location"] = _field_from_line(
            "location", location_value, location_line, config
        )
    else:
        fields["location"] = _missing("location", "", "未识别地点，可留空")

    if week_line and weeks and not week_error:
        fields["weeks"] = _field_from_line("weeks", weeks, week_line, config)
        fields["parity"] = _field_from_line(
            "parity",
            parity,
            week_line,
            config,
            extra_reason=(
                "未发现单双周标记，按每周解释" if parity == "all" else None
            ),
        )
    elif week_line:
        fields["weeks"] = ParsedField(
            field="weeks",
            value=[1],
            status="review",
            confidence=week_line.confidence,
            raw_text=week_line.text,
            box=week_line.box,
            reason=week_error or "教学周表达无法确定",
        )
        fields["parity"] = ParsedField(
            field="parity",
            value=parity,
            status="review",
            confidence=week_line.confidence,
            raw_text=week_line.text,
            box=week_line.box,
            reason="教学周解析失败，单双周设置需要复核",
        )
    else:
        fields["weeks"] = _missing("weeks", [1], "未识别教学周，临时占位为第 1 周")
        fields["parity"] = _missing("parity", "all", "未识别教学周，单双周需要确认")

    return fields
