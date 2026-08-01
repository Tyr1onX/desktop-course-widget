from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from .models import PixelBox

WEEKDAY_TEXT = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


@dataclass(frozen=True)
class ChineseCourse:
    weekday: int
    start_section: int
    end_section: int
    name: str
    weeks: tuple[int, ...]
    parity: str = "all"
    teacher: str = ""
    location: str = ""
    joined_location_line: bool = False
    confidence: float = 0.97


@dataclass(frozen=True)
class ChineseTimetableStyle:
    name: str
    section_count: int
    visual: str
    courses: tuple[ChineseCourse, ...]


def _weeks(start: int, end: int) -> tuple[int, ...]:
    return tuple(range(start, end + 1))


def styles() -> dict[str, ChineseTimetableStyle]:
    return {
        "mobile_cards_12": ChineseTimetableStyle(
            name="mobile_cards_12",
            section_count=12,
            visual="cards",
            courses=(
                ChineseCourse(1, 1, 2, "通信原理", _weeks(1, 8), teacher="张老师", location="南湖-第一教学楼-四阶"),
                ChineseCourse(3, 3, 4, "数字信号处理A", _weeks(3, 14), teacher="朴美兰老师", location="南湖-第一教学楼-七阶", confidence=0.86),
                ChineseCourse(5, 6, 7, "单片机原理及其应用", _weeks(1, 15), parity="odd", teacher="刘聪老师", location="南岭-逸夫楼A203"),
                ChineseCourse(7, 9, 10, "通信与网络", _weeks(2, 16), parity="even"),
            ),
        ),
        "minimal_lines_10": ChineseTimetableStyle(
            name="minimal_lines_10",
            section_count=10,
            visual="minimal",
            courses=(
                ChineseCourse(2, 1, 2, "信息论", _weeks(1, 16), teacher="王海老师", location="中心校区-经信楼B201"),
                ChineseCourse(4, 3, 4, "高频电子技术", _weeks(1, 8) + _weeks(10, 12), teacher="陈晓老师", location="南湖-实验楼305"),
                ChineseCourse(6, 5, 6, "嵌入式系统设计", _weeks(2, 14), parity="even", teacher="周宁老师", location="南岭-工程训练中心"),
                ChineseCourse(1, 8, 9, "电磁场与电磁波", _weeks(1, 15), parity="odd", location="前卫-理科楼A109"),
            ),
        ),
        "dense_export_12": ChineseTimetableStyle(
            name="dense_export_12",
            section_count=12,
            visual="dense",
            courses=(
                ChineseCourse(1, 2, 3, "数字通信原理与系统", _weeks(1, 16), teacher="李明老师", location="南湖-第一教学楼-三阶", joined_location_line=True),
                ChineseCourse(2, 4, 5, "微机原理与接口技术", _weeks(1, 8) + _weeks(10, 16), teacher="赵雪老师", location="南岭-逸夫教学楼C402"),
                ChineseCourse(4, 7, 8, "现代交换技术与通信网", _weeks(3, 15), parity="odd", teacher="孙悦老师", location="南湖-实验中心506", confidence=0.83),
                ChineseCourse(6, 10, 11, "专业实践（通信系统综合设计）", _weeks(9, 16), teacher="吴桐老师", location="南岭-工程训练基地"),
            ),
        ),
    }


def style_names() -> tuple[str, ...]:
    return tuple(sorted(styles()))


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        os.environ.get("SCREENSHOT_IMPORT_FONT_BOLD" if bold else "SCREENSHOT_IMPORT_FONT"),
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" if bold else "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def _week_expression(course: ChineseCourse) -> str:
    weeks = list(course.weeks)
    segments: list[str] = []
    start = previous = weeks[0]
    for value in weeks[1:]:
        if value == previous + 1:
            previous = value
            continue
        segments.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = value
    segments.append(str(start) if start == previous else f"{start}-{previous}")
    suffix = "(单)" if course.parity == "odd" else "(双)" if course.parity == "even" else ""
    return f"{','.join(segments)}周{suffix}"


def _truth(style: ChineseTimetableStyle) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "source": f"synthetic-chinese:{style.name}",
        "courses": [
            {
                "weekday": course.weekday,
                "startSection": course.start_section,
                "endSection": course.end_section,
                "name": course.name,
                "teacher": course.teacher,
                "location": course.location,
                "weeks": list(course.weeks),
                "parity": course.parity,
            }
            for course in style.courses
        ],
    }


def _text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=font)
    return max(1, box[2] - box[0]), max(1, box[3] - box[1])


def _draw_token(
    draw: ImageDraw.ImageDraw,
    tokens: list[dict[str, Any]],
    position: tuple[float, float],
    text: str,
    font: ImageFont.ImageFont,
    *,
    confidence: float = 0.99,
    fill: tuple[int, int, int] = (32, 38, 46),
) -> PixelBox:
    x, y = position
    width, height = _text_size(draw, text, font)
    draw.text((x, y), text, font=font, fill=fill)
    box = PixelBox(float(x), float(y), float(width), float(height))
    tokens.append({"text": text, "confidence": confidence, "box": box.to_dict()})
    return box


def _fragment_line(
    draw: ImageDraw.ImageDraw,
    tokens: list[dict[str, Any]],
    x: float,
    y: float,
    fragments: tuple[str, ...],
    font: ImageFont.ImageFont,
    *,
    confidence: float,
    fill: tuple[int, int, int],
) -> None:
    cursor = x
    for fragment in fragments:
        box = _draw_token(draw, tokens, (cursor, y), fragment, font, confidence=confidence, fill=fill)
        cursor = box.right + 4


def _card_colors(visual: str, index: int) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    if visual == "minimal":
        return (250, 250, 249), (176, 181, 188)
    if visual == "dense":
        fills = ((232, 242, 255), (241, 235, 255), (233, 249, 238), (255, 241, 226))
        return fills[index % len(fills)], (116, 127, 142)
    fills = ((224, 239, 255), (240, 232, 255), (226, 248, 233), (255, 238, 220))
    return fills[index % len(fills)], (112, 135, 158)


def generate_chinese_timetable_sample(
    output_dir: str | Path,
    style_name: str,
) -> dict[str, Path]:
    try:
        style = styles()[style_name]
    except KeyError as error:
        raise ValueError(f"unknown Chinese timetable style: {style_name}") from error

    margin = 42
    label_width = 92
    day_width = 214
    header_height = 76
    row_height = 92 if style.visual != "dense" else 82
    table_x = margin + label_width
    table_y = margin + header_height
    width = table_x + 7 * day_width + margin
    height = table_y + style.section_count * row_height + margin
    background = (246, 247, 249) if style.visual == "cards" else (255, 255, 255)
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)
    header_font = _font(21, bold=True)
    label_font = _font(16)
    course_font = _font(13)
    course_bold = _font(17, bold=True)
    tokens: list[dict[str, Any]] = []

    if style.visual in {"minimal", "dense"}:
        line_color = (226, 229, 233) if style.visual == "minimal" else (174, 181, 190)
        line_width = 1 if style.visual == "minimal" else 2
        for index in range(8):
            x = table_x + index * day_width
            draw.line((x, margin, x, table_y + style.section_count * row_height), fill=line_color, width=line_width)
        for section in range(style.section_count + 1):
            y = table_y + section * row_height
            draw.line((margin, y, table_x + 7 * day_width, y), fill=line_color, width=line_width)
        draw.line((margin, margin + header_height - 1, table_x + 7 * day_width, margin + header_height - 1), fill=line_color, width=line_width)

    for weekday, title in enumerate(WEEKDAY_TEXT, start=1):
        center = table_x + (weekday - 0.5) * day_width
        text_width, _ = _text_size(draw, title, header_font)
        if style.visual == "cards":
            draw.rounded_rectangle((center - 42, margin + 11, center + 42, margin + 51), radius=18, fill=(255, 255, 255), outline=(222, 226, 232))
        _draw_token(draw, tokens, (center - text_width / 2, margin + 18), title, header_font)

    for section in range(1, style.section_count + 1):
        center_y = table_y + (section - 0.5) * row_height
        label = str(section)
        text_width, text_height = _text_size(draw, label, label_font)
        _draw_token(
            draw,
            tokens,
            (margin + (label_width - text_width) / 2, center_y - text_height / 2),
            label,
            label_font,
            fill=(104, 112, 124),
        )

    for index, course in enumerate(style.courses):
        left = table_x + (course.weekday - 1) * day_width + 7
        right = table_x + course.weekday * day_width - 7
        top = table_y + (course.start_section - 1) * row_height + 6
        bottom = table_y + course.end_section * row_height - 6
        fill, outline = _card_colors(style.visual, index)
        radius = 18 if style.visual == "cards" else 7 if style.visual == "dense" else 3
        draw.rounded_rectangle((left, top, right, bottom), radius=radius, fill=fill, outline=outline, width=2)

        text_x = left + 9
        cursor_y = top + 8
        weekday_text = WEEKDAY_TEXT[course.weekday - 1]
        section_text = f"第{course.start_section}节-第{course.end_section}节"
        week_text = _week_expression(course)
        _fragment_line(
            draw,
            tokens,
            text_x,
            cursor_y,
            (weekday_text, section_text, week_text),
            course_font,
            confidence=course.confidence,
            fill=(54, 65, 78),
        )
        cursor_y += 25
        _draw_token(draw, tokens, (text_x, cursor_y), course.name, course_bold, confidence=course.confidence)
        cursor_y += 27
        if course.teacher:
            _draw_token(draw, tokens, (text_x, cursor_y), course.teacher, course_font, confidence=course.confidence)
            cursor_y += 23
        if course.location:
            # Preserve the real parser regression shape without emitting a second
            # complete time anchor. OCR may leave only the trailing “节,” fragment
            # before the location after the primary time line has already been read.
            location_text = (
                f"节,{course.location}"
                if course.joined_location_line
                else course.location
            )
            _draw_token(draw, tokens, (text_x, cursor_y), location_text, course_font, confidence=course.confidence)

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    image_path = output / f"{style.name}.png"
    fixture_path = output / f"{style.name}.ocr.json"
    truth_path = output / f"{style.name}.ground-truth.json"
    image.save(image_path, "PNG", optimize=False)
    fixture_path.write_text(
        json.dumps({"name": style.name, "tokens": tokens}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    truth_path.write_text(
        json.dumps(_truth(style), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"image": image_path, "ocr": fixture_path, "groundTruth": truth_path}


def generate_chinese_timetable_corpus(
    output_dir: str | Path,
    style_names_requested: tuple[str, ...] | list[str] | None = None,
) -> dict[str, dict[str, Path]]:
    names = tuple(style_names_requested or style_names())
    unknown = [name for name in names if name not in styles()]
    if unknown:
        raise ValueError("unknown Chinese timetable styles: " + ", ".join(unknown))
    return {
        name: generate_chinese_timetable_sample(output_dir, name)
        for name in names
    }
