from __future__ import annotations

import re
from dataclasses import dataclass
from statistics import median
from typing import Any

from .models import CourseBlock, GridResult, OcrToken, PixelBox
from .parse_fields import normalize_text

_WEEKDAY = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
    "日": 7, "天": 7, "1": 1, "2": 2, "3": 3, "4": 4,
    "5": 5, "6": 6, "7": 7,
}
_WEEKDAY_RE = re.compile(r"(?:星期|礼拜|周)\s*([一二三四五六日天1-7])")
_HEADER_RE = re.compile(r"^(?:星期|礼拜|周)\s*([一二三四五六日天1-7])$")
_SECTION_RANGE_RE = re.compile(
    r"第\s*(\d{1,2})\s*节\s*[-~～至]\s*(?:第\s*)?(\d{1,2})(?:\s*节)?"
)
_SECTION_LIST_RE = re.compile(
    r"第\s*(\d{1,2})(?:\s*[,，、.]\s*\d{1,2})*\s*[,，、.]\s*(\d{1,2})\s*节"
)
_SECTION_PAIR_RE = re.compile(r"第\s*(\d{1,2})\s*[,，、.]\s*(?:第\s*)?(\d{1,2})\s*节")
_SECTION_RE = re.compile(r"第\s*(\d{1,2})\s*节")
_SECTION_LABEL_RE = re.compile(r"^(?:第\s*)?(\d{1,2})(?:\s*节)?$")
_WEEK_RANGE_RE = re.compile(
    r"(?:第\s*)?\d{1,2}(?:\s*[-~～至]\s*\d{1,2})?\s*周"
)

Anchor = tuple[OcrToken, int, tuple[int, int], bool, bool]


@dataclass
class OcrFirstResult:
    blocks: list[CourseBlock]
    tokens_by_block: list[list[OcrToken]]
    table_box: PixelBox | None
    weekday_centers: dict[int, float]
    section_centers: dict[int, float]
    warnings: list[str]
    anchors: list[dict[str, Any]]

    @property
    def confidence(self) -> float:
        return (
            sum(block.confidence for block in self.blocks) / len(self.blocks)
            if self.blocks
            else 0.0
        )

    def diagnostics(self) -> dict[str, Any]:
        return {
            "strategy": "ocr-first",
            "tableBox": self.table_box.to_dict() if self.table_box else None,
            "weekdayCenters": {
                str(key): round(value, 3)
                for key, value in self.weekday_centers.items()
            },
            "sectionCenters": {
                str(key): round(value, 3)
                for key, value in self.section_centers.items()
            },
            "anchors": self.anchors,
            "warnings": self.warnings,
        }


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", normalize_text(text))


def parse_weekday_from_text(text: str) -> int | None:
    match = _WEEKDAY_RE.search(_compact(text))
    return _WEEKDAY.get(match.group(1)) if match else None


def parse_sections_from_text(text: str) -> tuple[int, int] | None:
    compact = _compact(text)
    match = (
        _SECTION_RANGE_RE.search(compact)
        or _SECTION_LIST_RE.search(compact)
        or _SECTION_PAIR_RE.search(compact)
        or _SECTION_RE.search(compact)
    )
    if not match:
        return None
    start = int(match.group(1))
    end = int(match.group(2) or match.group(1))
    return (start, end) if 1 <= start <= end <= 30 else None


def _header_value(token: OcrToken) -> int | None:
    match = _HEADER_RE.fullmatch(_compact(token.text))
    return _WEEKDAY.get(match.group(1)) if match else None


def _weekday_headers(tokens: list[OcrToken]) -> dict[int, OcrToken]:
    candidates = [(token, _header_value(token)) for token in tokens]
    candidates = [(token, value) for token, value in candidates if value is not None]
    if not candidates:
        return {}
    tolerance = median(max(1.0, token.box.height) for token, _ in candidates) * 1.25
    groups: list[list[tuple[OcrToken, int]]] = []
    for token, value in sorted(
        candidates, key=lambda item: item[0].box.center[1]
    ):
        for group in groups:
            group_y = median(item[0].box.center[1] for item in group)
            if abs(token.box.center[1] - group_y) <= tolerance:
                group.append((token, int(value)))
                break
        else:
            groups.append([(token, int(value))])
    best = max(groups, key=lambda group: len({value for _, value in group}))
    result: dict[int, OcrToken] = {}
    for token, value in sorted(best, key=lambda item: item[0].box.x):
        result.setdefault(value, token)
    return result if len(result) >= 4 else {}


def _spacing(centers: dict[int, float], image_width: int) -> float:
    values = sorted(centers.values())
    gaps = [right - left for left, right in zip(values, values[1:]) if right > left]
    return median(gaps) if gaps else max(20.0, image_width * 0.12)


def _section_labels(
    tokens: list[OcrToken],
    centers: dict[int, float],
    header_y: float,
    image_width: int,
) -> dict[int, OcrToken]:
    if not centers:
        return {}
    spacing = _spacing(centers, image_width)
    first_x = min(centers.values())
    found: dict[int, list[OcrToken]] = {}
    for token in tokens:
        match = _SECTION_LABEL_RE.fullmatch(_compact(token.text))
        if not match:
            continue
        value = int(match.group(1))
        x, y = token.box.center
        if (
            1 <= value <= 30
            and first_x - 1.8 * spacing <= x <= first_x - 0.15 * spacing
            and y > header_y
        ):
            found.setdefault(value, []).append(token)
    result: dict[int, OcrToken] = {}
    previous_y = header_y
    for value in range(1, 31):
        options = [
            token
            for token in found.get(value, [])
            if token.box.center[1] > previous_y
        ]
        if not options:
            break
        result[value] = min(options, key=lambda token: token.box.center[1])
        previous_y = result[value].box.center[1]
    return result if len(result) >= 4 else {}


def _layout(
    tokens: list[OcrToken], image_width: int, image_height: int
) -> tuple[PixelBox | None, dict[int, float], dict[int, float], list[str]]:
    headers = _weekday_headers(tokens)
    if not headers:
        return None, {}, {}, ["未可靠找到星期表头，仅使用课程文字中的显式时间"]
    weekday_centers = {
        key: token.box.center[0] for key, token in headers.items()
    }
    header_y = median(token.box.center[1] for token in headers.values())
    labels = _section_labels(tokens, weekday_centers, header_y, image_width)
    section_centers = {
        key: token.box.center[1] for key, token in labels.items()
    }
    spacing = _spacing(weekday_centers, image_width)
    left = max(0.0, min(weekday_centers.values()) - spacing * 0.48)
    right = min(
        float(image_width), max(weekday_centers.values()) + spacing * 0.48
    )
    top = max(0.0, min(token.box.y for token in headers.values()) - 4.0)
    warnings: list[str] = []
    if section_centers:
        values = [section_centers[key] for key in sorted(section_centers)]
        gaps = [right_y - left_y for left_y, right_y in zip(values, values[1:])]
        row_height = median(gaps) if gaps else 20.0
        bottom = min(float(image_height), max(values) + row_height * 0.6)
    else:
        bottom = float(image_height)
        warnings.append("未可靠找到节次标签，节次需由课程文字或网格辅助")
    return (
        PixelBox(left, top, right - left, bottom - top),
        weekday_centers,
        section_centers,
        warnings,
    )


def _infer_weekday(
    x: float,
    centers: dict[int, float],
    grid: GridResult | None,
    image_width: int,
) -> int | None:
    if centers:
        weekday, distance = min(
            ((key, abs(value - x)) for key, value in centers.items()),
            key=lambda item: item[1],
        )
        return (
            weekday
            if distance <= _spacing(centers, image_width) * 0.62
            else None
        )
    if grid:
        for weekday, box in enumerate(grid.weekday_columns, start=1):
            if box.x <= x <= box.right:
                return weekday
    return None


def _infer_sections(
    box: PixelBox,
    centers: dict[int, float],
    grid: GridResult | None,
) -> tuple[int, int] | None:
    if centers:
        section = min(
            centers, key=lambda key: abs(centers[key] - box.center[1])
        )
        return section, section
    if grid:
        rows = [
            index
            for index, row in enumerate(grid.section_rows, start=1)
            if max(0.0, min(box.bottom, row.bottom) - max(box.y, row.y)) > 0
        ]
        if rows:
            return min(rows), max(rows)
    return None


def _is_label(
    token: OcrToken,
    weekday_centers: dict[int, float],
    section_centers: dict[int, float],
) -> bool:
    if _header_value(token) is not None:
        return True
    match = _SECTION_LABEL_RE.fullmatch(_compact(token.text))
    return bool(match and int(match.group(1)) in section_centers)


def _box_gap(left: PixelBox, right: PixelBox) -> float:
    if left.right < right.x:
        return right.x - left.right
    if right.right < left.x:
        return left.x - right.right
    return 0.0


def _explicit_time_evidence(
    token: OcrToken, tokens: list[OcrToken]
) -> tuple[int | None, tuple[int, int] | None]:
    """Resolve OCR fragments belonging to one visual time line.

    A renderer may return `周三` and `第3,4节（第1-17周）` as separate
    tokens. Their individual centers can fall in different weekday columns, so
    complementary explicit evidence is joined before any coordinate inference.
    """
    weekday = parse_weekday_from_text(token.text)
    sections = parse_sections_from_text(token.text)
    if weekday is not None and sections is not None:
        return weekday, sections
    best: tuple[float, OcrToken, int | None, tuple[int, int] | None] | None = None
    for other in tokens:
        if other is token:
            continue
        other_weekday = parse_weekday_from_text(other.text)
        other_sections = parse_sections_from_text(other.text)
        if weekday is None and other_weekday is None:
            continue
        if sections is None and other_sections is None:
            continue
        if weekday is not None and other_weekday is not None:
            continue
        if sections is not None and other_sections is not None:
            continue
        height = max(token.box.height, other.box.height, 1.0)
        vertical_distance = abs(token.box.center[1] - other.box.center[1])
        gap = _box_gap(token.box, other.box)
        if vertical_distance > height * 0.75 or gap > height * 2.5:
            continue
        score = vertical_distance + gap
        if best is None or score < best[0]:
            best = (score, other, other_weekday, other_sections)
    if best is not None:
        _, _, other_weekday, other_sections = best
        weekday = weekday or other_weekday
        sections = sections or other_sections
    return weekday, sections


def _coalesce_split_time_anchors(anchors: list[Anchor]) -> list[Anchor]:
    """Collapse fragments on one line while preserving distinct rows."""
    result: list[Anchor] = []
    for candidate in sorted(
        anchors,
        key=lambda item: (
            item[1],
            item[2][0],
            item[2][1],
            item[0].box.center[1],
            item[0].box.x,
        ),
    ):
        token, weekday, sections, explicit_weekday, explicit_sections = candidate
        for index, existing in enumerate(result):
            (
                other,
                other_weekday,
                other_sections,
                other_weekday_explicit,
                other_sections_explicit,
            ) = existing
            if other_weekday != weekday or other_sections != sections:
                continue
            tolerance = max(token.box.height, other.box.height, 1.0) * 1.25
            if abs(token.box.center[1] - other.box.center[1]) > tolerance:
                continue
            candidate_score = (
                int(explicit_weekday) + int(explicit_sections),
                len(_compact(token.text)),
                token.confidence,
            )
            existing_score = (
                int(other_weekday_explicit) + int(other_sections_explicit),
                len(_compact(other.text)),
                other.confidence,
            )
            representative = token if candidate_score > existing_score else other
            result[index] = (
                representative,
                weekday,
                sections,
                explicit_weekday or other_weekday_explicit,
                explicit_sections or other_sections_explicit,
            )
            break
        else:
            result.append(candidate)
    return result


def discover_ocr_first_courses(
    tokens: list[OcrToken],
    *,
    image_width: int,
    image_height: int,
    grid: GridResult | None = None,
) -> OcrFirstResult:
    table_box, weekday_centers, section_centers, warnings = _layout(
        tokens, image_width, image_height
    )
    usable = [
        token
        for token in tokens
        if token.confidence >= 0.45
        and (
            table_box is None
            or (
                table_box.x <= token.box.center[0] <= table_box.right
                and table_box.y <= token.box.center[1] <= table_box.bottom
            )
        )
    ]
    anchors: list[Anchor] = []
    for token in usable:
        if _is_label(token, weekday_centers, section_centers):
            continue
        explicit_weekday, explicit_sections = _explicit_time_evidence(
            token, usable
        )
        if explicit_weekday is None and explicit_sections is None:
            continue
        weekday = explicit_weekday or _infer_weekday(
            token.box.center[0], weekday_centers, grid, image_width
        )
        sections = explicit_sections or _infer_sections(
            token.box, section_centers, grid
        )
        compact = _compact(token.text)
        if weekday is None or sections is None:
            continue
        if (
            explicit_weekday is None
            and not _WEEK_RANGE_RE.search(compact)
            and _SECTION_LABEL_RE.fullmatch(compact)
        ):
            continue
        anchors.append(
            (
                token,
                weekday,
                sections,
                explicit_weekday is not None,
                explicit_sections is not None,
            )
        )
    anchors = _coalesce_split_time_anchors(anchors)
    anchors.sort(key=lambda item: (item[1], item[2][0], item[0].box.y))

    blocks: list[CourseBlock] = []
    grouped_tokens: list[list[OcrToken]] = []
    diagnostics: list[dict[str, Any]] = []
    for token, weekday, sections, explicit_weekday, explicit_sections in anchors:
        same_column = sorted(
            [item for item in anchors if item[1] == weekday],
            key=lambda item: item[0].box.center[1],
        )
        position = next(
            index for index, item in enumerate(same_column) if item[0] is token
        )
        y = token.box.center[1]
        upper = table_box.y if table_box else 0.0
        lower = table_box.bottom if table_box else float(image_height)
        if position:
            upper = max(
                upper,
                (same_column[position - 1][0].box.center[1] + y) / 2.0,
            )
        if position + 1 < len(same_column):
            lower = min(
                lower,
                (y + same_column[position + 1][0].box.center[1]) / 2.0,
            )
        if weekday_centers and weekday in weekday_centers:
            ordered = sorted(
                weekday_centers.items(), key=lambda item: item[1]
            )
            column_index = next(
                index
                for index, item in enumerate(ordered)
                if item[0] == weekday
            )
            center = ordered[column_index][1]
            gap = _spacing(weekday_centers, image_width)
            left = (
                (ordered[column_index - 1][1] + center) / 2
                if column_index
                else center - gap / 2
            )
            right = (
                (center + ordered[column_index + 1][1]) / 2
                if column_index + 1 < len(ordered)
                else center + gap / 2
            )
        elif grid and 1 <= weekday <= len(grid.weekday_columns):
            left = grid.weekday_columns[weekday - 1].x
            right = grid.weekday_columns[weekday - 1].right
        else:
            left = token.box.x - token.box.width
            right = token.box.right + token.box.width
        group = [
            item
            for item in usable
            if left <= item.box.center[0] <= right
            and upper <= item.box.center[1] <= lower
            and not _is_label(item, weekday_centers, section_centers)
        ]
        if token not in group:
            group.append(token)
        group.sort(key=lambda item: (item.box.y, item.box.x))
        box = PixelBox.union(item.box for item in group) or token.box
        block_warnings: list[str] = []
        if not explicit_weekday:
            block_warnings.append("星期由文字坐标推断，需要复核")
        if not explicit_sections:
            block_warnings.append("节次由文字坐标推断，需要复核")
        confidence = (
            0.58
            + (0.18 if explicit_weekday else 0.08)
            + (0.18 if explicit_sections else 0.08)
        )
        blocks.append(
            CourseBlock(
                weekday,
                sections[0],
                sections[1],
                box,
                box,
                min(0.99, confidence),
                block_warnings,
            )
        )
        grouped_tokens.append(group)
        diagnostics.append(
            {
                "text": token.text,
                "weekday": weekday,
                "startSection": sections[0],
                "endSection": sections[1],
                "tokenCount": len(group),
                "explicitWeekday": explicit_weekday,
                "explicitSections": explicit_sections,
            }
        )
    if not blocks:
        warnings.append("整图 OCR 已完成，但未从文字与坐标中形成课程记录")
    return OcrFirstResult(
        blocks,
        grouped_tokens,
        table_box,
        weekday_centers,
        section_centers,
        warnings,
        diagnostics,
    )
