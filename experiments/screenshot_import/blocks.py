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
    missing_boundary_threshold: float = 0.08
    weak_boundary_threshold: float = 0.28
    color_distance_threshold: float = 42.0
    color_ambiguity_margin: float = 8.0


@dataclass(frozen=True)
class BoundaryDecision:
    merge: bool
    ambiguous: bool
    warning: str | None = None


def _boundary_decision(
    boundary_strength: float,
    color_distance: float,
    config: CourseBlockDetectionConfig,
) -> BoundaryDecision:
    """Decide whether two occupied adjacent cells belong to one block.

    A clear structural line always wins. A missing/weak line is only evidence for
    merging when the colors are continuous; missing structure plus distinct
    colors remains split and is explicitly marked for review.
    """
    boundary_missing = boundary_strength < config.missing_boundary_threshold
    boundary_weak = (
        config.missing_boundary_threshold
        <= boundary_strength
        < config.weak_boundary_threshold
    )
    colors_continuous = color_distance <= config.color_distance_threshold
    colors_near_limit = (
        config.color_distance_threshold - config.color_ambiguity_margin
        < color_distance
        <= config.color_distance_threshold
    )

    if boundary_strength >= config.weak_boundary_threshold:
        return BoundaryDecision(merge=False, ambiguous=False)

    if boundary_missing and colors_continuous:
        if colors_near_limit:
            return BoundaryDecision(
                merge=True,
                ambiguous=True,
                warning=(
                    f"内部边界缺失，但相邻颜色距离 {color_distance:.1f} 接近合并阈值，"
                    "跨节判断需要复核"
                ),
            )
        return BoundaryDecision(merge=True, ambiguous=False)

    if boundary_weak and colors_continuous:
        return BoundaryDecision(
            merge=True,
            ambiguous=True,
            warning=(
                f"内部横线较弱（{boundary_strength:.2f}），依据颜色连续性合并，"
                "跨节判断需要复核"
            ),
        )

    if boundary_missing:
        return BoundaryDecision(
            merge=False,
            ambiguous=True,
            warning=(
                f"内部边界缺失但相邻颜色差异较大（距离 {color_distance:.1f}），"
                "保留为独立课程并需要复核"
            ),
        )

    return BoundaryDecision(
        merge=False,
        ambiguous=True,
        warning=(
            f"内部横线较弱且相邻颜色不连续（距离 {color_distance:.1f}），"
            "保留为独立课程并需要复核"
        ),
    )


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
    cell_map = {(cell.weekday, cell.section): cell for cell in grid.cells}

    for weekday in range(1, grid.weekday_count + 1):
        features = [
            _cell_features(
                hsv,
                image.working_bgr,
                cell_map[(weekday, section)].working_box,
                config,
            )
            for section in range(1, grid.section_count + 1)
        ]
        carried_warnings: dict[int, list[str]] = {}
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
            warnings = list(carried_warnings.pop(start, []))
            while end < grid.section_count:
                next_ratio, next_color = features[end]
                if next_ratio < config.minimum_fill_ratio:
                    break
                boundary_y = grid.working_horizontal_lines[end + 1]
                boundary_strength = _boundary_strength(grid, weekday, boundary_y)
                color_distance = float(np.linalg.norm(np.mean(colors, axis=0) - next_color))
                decision = _boundary_decision(boundary_strength, color_distance, config)
                if decision.warning:
                    warnings.append(
                        f"第 {end} 与第 {end + 1} 节：{decision.warning}"
                    )
                if not decision.merge:
                    if decision.warning:
                        carried_warnings.setdefault(end + 1, []).append(
                            f"第 {end} 与第 {end + 1} 节：{decision.warning}"
                        )
                    break
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
            warnings = list(dict.fromkeys(warnings))
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
