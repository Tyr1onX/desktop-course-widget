from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .models import CourseBlock, GridResult, PixelBox, PreprocessedImage, transform_box


@dataclass(frozen=True)
class CourseBlockDetectionConfig:
    minimum_fill_ratio: float = 0.12
    minimum_saturation: int = 18
    minimum_value: int = 105
    boundary_line_threshold: float = 0.28
    color_distance_threshold: float = 42.0


def _cell_inner(box: PixelBox, margin: int = 4) -> tuple[int, int, int, int]:
    x1 = int(round(box.x)) + margin
    y1 = int(round(box.y)) + margin
    x2 = int(round(box.right)) - margin
    y2 = int(round(box.bottom)) - margin
    return x1, y1, max(x1 + 1, x2), max(y1 + 1, y2)


def _cell_features(
    hsv: np.ndarray,
    bgr: np.ndarray,
    box: PixelBox,
    config: CourseBlockDetectionConfig,
) -> tuple[float, np.ndarray]:
    x1, y1, x2, y2 = _cell_inner(box)
    roi_hsv = hsv[y1:y2, x1:x2]
    roi_bgr = bgr[y1:y2, x1:x2]
    if roi_hsv.size == 0:
        return 0.0, np.array([255.0, 255.0, 255.0], dtype=np.float64)
    saturation = roi_hsv[:, :, 1]
    value = roi_hsv[:, :, 2]
    mask = (saturation >= config.minimum_saturation) & (value >= config.minimum_value)
    fill_ratio = float(np.count_nonzero(mask) / mask.size)
    if np.count_nonzero(mask):
        mean_color = roi_bgr[mask].mean(axis=0).astype(np.float64)
    else:
        mean_color = roi_bgr.reshape(-1, 3).mean(axis=0).astype(np.float64)
    return fill_ratio, mean_color


def _boundary_strength(grid: GridResult, weekday: int, boundary_y: float) -> float:
    horizontal = grid.horizontal_mask
    if horizontal is None:
        return 1.0
    x1 = int(round(grid.working_vertical_lines[weekday])) + 3
    x2 = int(round(grid.working_vertical_lines[weekday + 1])) - 3
    y = int(round(boundary_y))
    y1 = max(0, y - 2)
    y2 = min(horizontal.shape[0], y + 3)
    x1 = max(0, x1)
    x2 = min(horizontal.shape[1], x2)
    if x2 <= x1 or y2 <= y1:
        return 1.0
    roi = horizontal[y1:y2, x1:x2]
    return float(np.count_nonzero(roi) / roi.size)


def detect_course_blocks(
    image: PreprocessedImage,
    grid: GridResult,
    config: CourseBlockDetectionConfig | None = None,
) -> list[CourseBlock]:
    config = config or CourseBlockDetectionConfig()
    hsv = cv2.cvtColor(image.working_bgr, cv2.COLOR_BGR2HSV)
    blocks: list[CourseBlock] = []

    # Map cells into a weekday/section matrix.
    cell_map = {(cell.weekday, cell.section): cell for cell in grid.cells}
    for weekday in range(1, grid.weekday_count + 1):
        features: list[tuple[float, np.ndarray]] = []
        for section in range(1, grid.section_count + 1):
            cell = cell_map[(weekday, section)]
            features.append(_cell_features(hsv, image.working_bgr, cell.working_box, config))

        section = 1
        while section <= grid.section_count:
            fill_ratio, color = features[section - 1]
            if fill_ratio < config.minimum_fill_ratio:
                section += 1
                continue

            start = section
            end = section
            ratios = [fill_ratio]
            colors = [color]
            warnings: list[str] = []
            while end < grid.section_count:
                next_ratio, next_color = features[end]
                if next_ratio < config.minimum_fill_ratio:
                    break
                boundary_y = grid.working_horizontal_lines[end + 1]
                boundary_strength = _boundary_strength(grid, weekday, boundary_y)
                color_distance = float(np.linalg.norm(np.mean(colors, axis=0) - next_color))
                merge = boundary_strength < config.boundary_line_threshold
                if not merge and color_distance < config.color_distance_threshold and boundary_strength < 0.12:
                    merge = True
                if not merge:
                    break
                if boundary_strength > config.boundary_line_threshold * 0.75:
                    warnings.append(
                        f"第 {end} 与第 {end + 1} 节边界较弱，跨节判断需要复核"
                    )
                end += 1
                ratios.append(next_ratio)
                colors.append(next_color)

            working_box = PixelBox(
                grid.working_vertical_lines[weekday],
                grid.working_horizontal_lines[start],
                grid.working_vertical_lines[weekday + 1]
                - grid.working_vertical_lines[weekday],
                grid.working_horizontal_lines[end + 1]
                - grid.working_horizontal_lines[start],
            )
            original_box = transform_box(working_box, image.inverse_transform).clipped(
                image.original_width, image.original_height
            )
            occupancy_score = min(1.0, float(np.mean(ratios)) / 0.65)
            confidence = max(
                0.0,
                min(1.0, 0.55 * grid.confidence + 0.45 * occupancy_score),
            )
            if confidence < 0.75:
                warnings.append(f"课程块定位置信度较低：{confidence:.2f}")
            blocks.append(
                CourseBlock(
                    weekday=weekday,
                    start_section=start,
                    end_section=end,
                    working_box=working_box,
                    original_box=original_box,
                    confidence=confidence,
                    warnings=warnings,
                )
            )
            section = end + 1

    blocks.sort(key=lambda block: (block.weekday, block.start_section, block.end_section))
    return blocks
