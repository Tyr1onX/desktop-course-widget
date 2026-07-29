from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .models import GridCell, GridResult, PixelBox, PreprocessedImage, transform_box, transform_points


class GridDetectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class GridDetectionConfig:
    expected_weekday_columns: int = 7
    minimum_section_rows: int = 10
    maximum_section_rows: int = 14
    vertical_coverage_threshold: float = 0.42
    horizontal_coverage_threshold: float = 0.45
    line_cluster_gap: int = 4


def _cluster_positions(indices: np.ndarray, weights: np.ndarray, gap: int) -> list[float]:
    if len(indices) == 0:
        return []
    groups: list[list[int]] = [[int(indices[0])]]
    for value in indices[1:]:
        value = int(value)
        if value - groups[-1][-1] <= gap:
            groups[-1].append(value)
        else:
            groups.append([value])
    centers: list[float] = []
    for group in groups:
        group_weights = np.asarray([weights[index] for index in group], dtype=np.float64)
        if float(group_weights.sum()) <= 0:
            centers.append(float(np.mean(group)))
        else:
            centers.append(float(np.average(group, weights=group_weights)))
    return centers


def _line_candidates(mask: np.ndarray, axis: int, threshold: float, gap: int) -> tuple[list[float], list[float]]:
    if axis == 0:  # vertical lines: project along rows
        projection = np.count_nonzero(mask, axis=0).astype(np.float64)
        denominator = max(1, mask.shape[0])
    else:  # horizontal lines: project along columns
        projection = np.count_nonzero(mask, axis=1).astype(np.float64)
        denominator = max(1, mask.shape[1])
    normalized = projection / denominator
    indices = np.flatnonzero(normalized >= threshold)
    centers = _cluster_positions(indices, projection, gap)
    coverage = [float(normalized[int(round(center))]) for center in centers]
    return centers, coverage


def _regularity(values: list[float], skip_first_spacing: bool = False) -> float:
    if len(values) < 3:
        return 0.0
    spacings = np.diff(np.asarray(values, dtype=np.float64))
    if skip_first_spacing and len(spacings) > 1:
        spacings = spacings[1:]
    if len(spacings) == 0 or float(np.mean(spacings)) <= 0:
        return 0.0
    coefficient = float(np.std(spacings) / np.mean(spacings))
    return max(0.0, min(1.0, 1.0 - coefficient * 2.5))


def _select_vertical_lines(
    positions: list[float],
    coverages: list[float],
    expected_count: int,
) -> tuple[list[float], list[float]]:
    if len(positions) < expected_count:
        raise GridDetectionError(
            f"网格竖线不足：需要 {expected_count} 条边界，实际检测到 {len(positions)} 条"
        )
    if len(positions) == expected_count:
        return positions, coverages

    best: tuple[float, list[float], list[float]] | None = None
    for start in range(0, len(positions) - expected_count + 1):
        candidate = positions[start : start + expected_count]
        candidate_coverage = coverages[start : start + expected_count]
        score = 0.65 * _regularity(candidate, skip_first_spacing=True) + 0.35 * float(
            np.mean(candidate_coverage)
        )
        if best is None or score > best[0]:
            best = (score, candidate, candidate_coverage)
    assert best is not None
    return best[1], best[2]


def _select_horizontal_lines(
    positions: list[float],
    coverages: list[float],
    minimum_sections: int,
    maximum_sections: int,
) -> tuple[list[float], list[float], int]:
    minimum_count = minimum_sections + 2  # top + header boundary + section bottoms
    maximum_count = maximum_sections + 2
    if len(positions) < minimum_count:
        raise GridDetectionError(
            f"网格横线不足：至少需要 {minimum_count} 条边界，实际检测到 {len(positions)} 条"
        )

    candidate_counts = [
        count for count in range(minimum_count, maximum_count + 1) if count <= len(positions)
    ]
    best: tuple[float, list[float], list[float], int] | None = None
    for count in candidate_counts:
        for start in range(0, len(positions) - count + 1):
            candidate = positions[start : start + count]
            candidate_coverage = coverages[start : start + count]
            spacings = np.diff(np.asarray(candidate, dtype=np.float64))
            if len(spacings) < 2:
                continue
            row_spacings = spacings[1:]
            if float(np.mean(row_spacings)) <= 0:
                continue
            row_regularity = max(
                0.0,
                min(1.0, 1.0 - float(np.std(row_spacings) / np.mean(row_spacings)) * 2.5),
            )
            header_ratio = float(spacings[0] / np.mean(row_spacings))
            header_score = max(0.0, 1.0 - abs(header_ratio - 0.9))
            score = (
                0.55 * row_regularity
                + 0.25 * float(np.mean(candidate_coverage))
                + 0.20 * header_score
            )
            if best is None or score > best[0]:
                best = (score, candidate, candidate_coverage, count - 2)
    if best is None:
        raise GridDetectionError("无法从横线候选中确定 10～14 节课的网格")
    return best[1], best[2], best[3]


def _axis_position_to_original(
    value: float,
    is_vertical: bool,
    working_table: PixelBox,
    inverse: np.ndarray,
) -> float:
    if is_vertical:
        points = np.array(
            [[value, working_table.y], [value, working_table.bottom]], dtype=np.float64
        )
        mapped = transform_points(points, inverse)
        return float(np.mean(mapped[:, 0]))
    points = np.array(
        [[working_table.x, value], [working_table.right, value]], dtype=np.float64
    )
    mapped = transform_points(points, inverse)
    return float(np.mean(mapped[:, 1]))


def detect_grid(
    image: PreprocessedImage,
    config: GridDetectionConfig | None = None,
) -> GridResult:
    config = config or GridDetectionConfig()
    binary = image.binary
    height, width = binary.shape[:2]

    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (max(25, width // 24), 1)
    )
    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (1, max(25, height // 24))
    )
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    horizontal = cv2.morphologyEx(
        horizontal,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (7, 1)),
    )
    vertical = cv2.morphologyEx(
        vertical,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, 7)),
    )

    grid_mask = cv2.bitwise_or(horizontal, vertical)
    points = cv2.findNonZero(grid_mask)
    if points is None:
        raise GridDetectionError("未检测到可见网格线")
    x, y, w, h = cv2.boundingRect(points)
    if w < width * 0.45 or h < height * 0.45:
        raise GridDetectionError("检测到的网格外框过小，图片可能不是完整标准课表")

    working_table = PixelBox(float(x), float(y), float(w), float(h))
    margin = max(2, config.line_cluster_gap)
    x1 = max(0, x - margin)
    y1 = max(0, y - margin)
    x2 = min(width, x + w + margin)
    y2 = min(height, y + h + margin)
    vertical_roi = vertical[y1:y2, x1:x2]
    horizontal_roi = horizontal[y1:y2, x1:x2]

    vertical_positions, vertical_coverage = _line_candidates(
        vertical_roi,
        axis=0,
        threshold=config.vertical_coverage_threshold,
        gap=config.line_cluster_gap,
    )
    horizontal_positions, horizontal_coverage = _line_candidates(
        horizontal_roi,
        axis=1,
        threshold=config.horizontal_coverage_threshold,
        gap=config.line_cluster_gap,
    )
    vertical_positions = [position + x1 for position in vertical_positions]
    horizontal_positions = [position + y1 for position in horizontal_positions]

    expected_vertical_count = config.expected_weekday_columns + 2
    vertical_positions, vertical_coverage = _select_vertical_lines(
        vertical_positions, vertical_coverage, expected_vertical_count
    )
    horizontal_positions, horizontal_coverage, section_count = _select_horizontal_lines(
        horizontal_positions,
        horizontal_coverage,
        config.minimum_section_rows,
        config.maximum_section_rows,
    )

    working_table = PixelBox(
        vertical_positions[0],
        horizontal_positions[0],
        vertical_positions[-1] - vertical_positions[0],
        horizontal_positions[-1] - horizontal_positions[0],
    )
    original_table = transform_box(working_table, image.inverse_transform).clipped(
        image.original_width, image.original_height
    )

    weekday_columns: list[PixelBox] = []
    for weekday in range(config.expected_weekday_columns):
        working_box = PixelBox(
            vertical_positions[weekday + 1],
            horizontal_positions[1],
            vertical_positions[weekday + 2] - vertical_positions[weekday + 1],
            horizontal_positions[-1] - horizontal_positions[1],
        )
        weekday_columns.append(
            transform_box(working_box, image.inverse_transform).clipped(
                image.original_width, image.original_height
            )
        )

    section_rows: list[PixelBox] = []
    cells: list[GridCell] = []
    for section in range(section_count):
        row_working = PixelBox(
            vertical_positions[1],
            horizontal_positions[section + 1],
            vertical_positions[-1] - vertical_positions[1],
            horizontal_positions[section + 2] - horizontal_positions[section + 1],
        )
        row_original = transform_box(row_working, image.inverse_transform).clipped(
            image.original_width, image.original_height
        )
        section_rows.append(row_original)
        for weekday in range(config.expected_weekday_columns):
            cell_working = PixelBox(
                vertical_positions[weekday + 1],
                horizontal_positions[section + 1],
                vertical_positions[weekday + 2] - vertical_positions[weekday + 1],
                horizontal_positions[section + 2] - horizontal_positions[section + 1],
            )
            cell_original = transform_box(cell_working, image.inverse_transform).clipped(
                image.original_width, image.original_height
            )
            cells.append(
                GridCell(
                    weekday=weekday + 1,
                    section=section + 1,
                    working_box=cell_working,
                    original_box=cell_original,
                )
            )

    vertical_regularity = _regularity(vertical_positions, skip_first_spacing=True)
    horizontal_regularity = _regularity(horizontal_positions[1:])
    coverage_score = float(np.mean(vertical_coverage + horizontal_coverage))
    confidence = max(
        0.0,
        min(1.0, 0.4 * coverage_score + 0.3 * vertical_regularity + 0.3 * horizontal_regularity),
    )
    warnings = list(image.warnings)
    if confidence < 0.85:
        warnings.append(f"网格检测置信度较低：{confidence:.2f}")
    if len(vertical_positions) != expected_vertical_count:
        warnings.append("竖线数量经过候选筛选")
    if not (config.minimum_section_rows <= section_count <= config.maximum_section_rows):
        raise GridDetectionError("检测到的节次行数不在 10～14 范围内")

    original_vertical_lines = [
        _axis_position_to_original(value, True, working_table, image.inverse_transform)
        for value in vertical_positions
    ]
    original_horizontal_lines = [
        _axis_position_to_original(value, False, working_table, image.inverse_transform)
        for value in horizontal_positions
    ]

    return GridResult(
        working_table_box=working_table,
        original_table_box=original_table,
        working_vertical_lines=vertical_positions,
        working_horizontal_lines=horizontal_positions,
        original_vertical_lines=original_vertical_lines,
        original_horizontal_lines=original_horizontal_lines,
        weekday_columns=weekday_columns,
        section_rows=section_rows,
        cells=cells,
        confidence=confidence,
        warnings=warnings,
        horizontal_mask=horizontal,
        vertical_mask=vertical,
    )
