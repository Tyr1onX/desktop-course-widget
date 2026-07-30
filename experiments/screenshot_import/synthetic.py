from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .models import PixelBox, transform_box


@dataclass(frozen=True)
class SyntheticCourse:
    weekday: int
    start_section: int
    end_section: int
    lines: tuple[str, ...]
    fill: tuple[int, int, int]


@dataclass(frozen=True)
class SyntheticBoundaryOverride:
    weekday: int
    after_section: int
    visible_fraction: float | None = None
    erase_grid: bool = False


@dataclass(frozen=True)
class SyntheticScenario:
    name: str
    section_count: int
    courses: tuple[SyntheticCourse, ...]
    angle: float = 0.0
    scale: float = 1.0
    boundaries: tuple[SyntheticBoundaryOverride, ...] = ()
    decorations: tuple[str, ...] = ()


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        os.environ.get("SCREENSHOT_IMPORT_FONT"),
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def _base_course(name: str, weekday: int, start: int, end: int, fill: tuple[int, int, int]) -> SyntheticCourse:
    return SyntheticCourse(weekday, start, end, (name, "1-8周", "张老师", "A101"), fill)


def scenarios() -> dict[str, SyntheticScenario]:
    blue = (220, 240, 255)
    violet = (235, 225, 255)
    green = (220, 250, 225)
    orange = (255, 235, 215)
    return {
        "standard_10": SyntheticScenario(
            name="standard_10", section_count=10,
            courses=(
                SyntheticCourse(1, 1, 2, ("通信原理", "1-8周", "张老师", "A101"), blue),
                SyntheticCourse(3, 3, 4, ("信息论", "1-15周(单)", "李明", "逸夫楼203"), violet),
                SyntheticCourse(5, 5, 6, ("数字信号处理", "1-16周(双)", "王老师"), green),
                SyntheticCourse(2, 7, 8, ("计算机网络", "1-8,10-16周", "赵老师", "B204"), orange),
                SyntheticCourse(2, 9, 10, ("电磁场", "1-12周", "陈老师", "实验楼301"), (255, 245, 205)),
            ),
        ),
        "tilted_12": SyntheticScenario(
            name="tilted_12", section_count=12, angle=1.8, scale=0.86,
            courses=(
                SyntheticCourse(4, 2, 4, ("高频电子技术", "第1-8周", "刘老师", "教学楼C302"), blue),
                SyntheticCourse(6, 6, 8, ("单片机原理", "1-15周(单)", "周老师", "逸夫楼405"), violet),
                SyntheticCourse(7, 9, 10, ("数字电路", "2-16周(双)", "孙老师", "D101"), green),
                SyntheticCourse(1, 11, 12, ("通信与网络", "1-16周", "吴老师"), orange),
            ),
        ),
        "weak_internal_line_10": SyntheticScenario(
            name="weak_internal_line_10", section_count=10,
            courses=(_base_course("跨节课程", 2, 2, 4, blue),),
            boundaries=(
                SyntheticBoundaryOverride(2, 2, visible_fraction=0.45),
                SyntheticBoundaryOverride(2, 3, visible_fraction=0.45),
            ),
        ),
        "similar_adjacent_10": SyntheticScenario(
            name="similar_adjacent_10", section_count=10,
            courses=(
                _base_course("相邻课程甲", 3, 4, 4, violet),
                _base_course("相邻课程乙", 3, 5, 5, violet),
            ),
        ),
        "distinct_missing_boundary_10": SyntheticScenario(
            name="distinct_missing_boundary_10", section_count=10,
            courses=(
                _base_course("不同颜色甲", 4, 6, 6, blue),
                _base_course("不同颜色乙", 4, 7, 7, orange),
            ),
            boundaries=(SyntheticBoundaryOverride(4, 6, erase_grid=True),),
        ),
        "double_border_10": SyntheticScenario(
            name="double_border_10", section_count=10,
            courses=(_base_course("双边框课程", 1, 1, 2, blue),),
            decorations=("double_border",),
        ),
        "title_decoration_10": SyntheticScenario(
            name="title_decoration_10", section_count=10,
            courses=(_base_course("装饰线课程", 5, 3, 4, green),),
            decorations=("title_horizontal",),
        ),
        "extra_vertical_10": SyntheticScenario(
            name="extra_vertical_10", section_count=10,
            courses=(_base_course("额外竖线课程", 7, 8, 9, orange),),
            decorations=("extra_vertical",),
        ),
    }


def _apply_affine(image: Image.Image, boxes: list[tuple[str, float, PixelBox]], angle: float, scale: float):
    array = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    height, width = array.shape[:2]
    matrix_2x3 = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), angle, scale)
    transformed = cv2.warpAffine(
        array, matrix_2x3, (width, height), flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255),
    )
    matrix = np.vstack([matrix_2x3, [0.0, 0.0, 1.0]])
    mapped = [(text, confidence, transform_box(box, matrix).clipped(width, height)) for text, confidence, box in boxes]
    return transformed, mapped


def _course_at(scenario: SyntheticScenario, weekday: int, section: int) -> SyntheticCourse | None:
    return next(
        (course for course in scenario.courses if course.weekday == weekday and course.start_section <= section <= course.end_section),
        None,
    )


def generate_synthetic_sample(output_dir: str | Path, scenario_name: str) -> dict[str, Path]:
    scenario = scenarios()[scenario_name]
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    time_width, day_width = 96, 170
    margin, header_height, row_height = 36, 68, 68
    table_width = time_width + 7 * day_width
    table_height = header_height + scenario.section_count * row_height
    width, height = table_width + margin * 2, table_height + margin * 2
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    font_header = _font(24)
    font_text = _font(18)
    x0, y0 = margin, margin
    grid_color = (65, 75, 85)
    weekdays = ("节次", "周一", "周二", "周三", "周四", "周五", "周六", "周日")
    x_lines = [x0, x0 + time_width] + [x0 + time_width + index * day_width for index in range(1, 8)]
    y_lines = [y0, y0 + header_height] + [y0 + header_height + index * row_height for index in range(1, scenario.section_count + 1)]
    for x in x_lines:
        draw.line((x, y0, x, y0 + table_height), fill=grid_color, width=2)
    for y in y_lines:
        draw.line((x0, y, x0 + table_width, y), fill=grid_color, width=2)
    for index, title in enumerate(weekdays):
        left, right = x_lines[index], x_lines[index + 1]
        bbox = draw.textbbox((0, 0), title, font=font_header)
        draw.text(((left + right - (bbox[2] - bbox[0])) / 2, y0 + 18), title, fill=(25, 30, 35), font=font_header)
    for section in range(1, scenario.section_count + 1):
        text = str(section)
        bbox = draw.textbbox((0, 0), text, font=font_header)
        top, bottom = y_lines[section], y_lines[section + 1]
        draw.text((x0 + (time_width - (bbox[2] - bbox[0])) / 2, (top + bottom - (bbox[3] - bbox[1])) / 2 - 2), text, fill=(25, 30, 35), font=font_header)

    tokens: list[tuple[str, float, PixelBox]] = []
    for course_index, course in enumerate(scenario.courses):
        left = x_lines[course.weekday] + 3
        right = x_lines[course.weekday + 1] - 3
        top = y_lines[course.start_section] + 3
        bottom = y_lines[course.end_section + 1] - 3
        draw.rectangle((left, top, right, bottom), fill=course.fill, outline=(75, 105, 130), width=2)
        available_height = bottom - top - 8
        line_step = max(18, min(27, available_height // max(1, len(course.lines))))
        cursor_y = top + 5
        for line_index, text in enumerate(course.lines):
            bbox = draw.textbbox((0, 0), text, font=font_text)
            max_width = right - left - 8
            if bbox[2] - bbox[0] > max_width:
                text = text[: max(2, int(len(text) * max_width / (bbox[2] - bbox[0])))]
                bbox = draw.textbbox((0, 0), text, font=font_text)
            tx, ty = left + 5, cursor_y
            draw.text((tx, ty), text, fill=(20, 25, 30), font=font_text)
            token_box = PixelBox(float(tx), float(ty), float(max(2, bbox[2] - bbox[0])), float(max(2, bbox[3] - bbox[1])))
            confidence = 0.98 if line_index != 0 else (0.94 if course_index % 2 == 0 else 0.88)
            tokens.append((text, confidence, token_box))
            cursor_y += line_step

    for override in scenario.boundaries:
        left = x_lines[override.weekday] + 3
        right = x_lines[override.weekday + 1] - 3
        boundary_y = y_lines[override.after_section + 1]
        if override.erase_grid:
            upper = _course_at(scenario, override.weekday, override.after_section)
            lower = _course_at(scenario, override.weekday, override.after_section + 1)
            if upper and lower:
                draw.rectangle((left, boundary_y - 3, right, boundary_y), fill=upper.fill)
                draw.rectangle((left, boundary_y + 1, right, boundary_y + 3), fill=lower.fill)
        if override.visible_fraction is not None:
            fraction = min(1.0, max(0.0, override.visible_fraction))
            draw.line((left, boundary_y, left + (right - left) * fraction, boundary_y), fill=grid_color, width=2)

    if "double_border" in scenario.decorations:
        inset = 7
        draw.rectangle((x0 - inset, y0 - inset, x_lines[-1] + inset, y_lines[-1] + inset), outline=grid_color, width=2)
    if "title_horizontal" in scenario.decorations:
        draw.line((x0 + time_width, y0 - 14, x_lines[-1], y0 - 14), fill=grid_color, width=2)
    if "extra_vertical" in scenario.decorations:
        x_extra = x_lines[1] + 14
        draw.line((x_extra, y0, x_extra, y_lines[-1]), fill=grid_color, width=2)

    transformed, mapped_tokens = _apply_affine(image, tokens, scenario.angle, scenario.scale)
    image_path = output / f"{scenario.name}.png"
    fixture_path = output / f"{scenario.name}.ocr.json"
    cv2.imwrite(str(image_path), transformed)
    fixture = {
        "name": scenario.name,
        "tokens": [
            {"text": text, "confidence": confidence, "box": box.to_dict()}
            for text, confidence, box in mapped_tokens
        ],
    }
    fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"image": image_path, "ocr": fixture_path}
