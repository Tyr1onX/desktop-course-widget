from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Any

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
    candidate_warning_margin: float = 0.06
    candidate_failure_margin: float = 0.003
    filtering_confidence_penalty: float = 0.04
    ambiguity_confidence_penalty: float = 0.10


@dataclass(frozen=True)
class _AxisSelection:
    positions: list[float]
    coverages: list[float]
    score: float
    runner_up_score: float | None
    selected_indices: list[int]
    selected_count: int
    raw_count: int
    candidate_count: int
    ambiguous: bool
    top_candidates: list[dict[str, Any]]

    @property
    def filtered(self) -> bool:
        return self.raw_count != self.selected_count

    @property
    def score_margin(self) -> float | None:
        if self.runner_up_score is None:
            return None
        return self.score - self.runner_up_score

    def diagnostics(self) -> dict[str, Any]:
        return {
            "rawCandidateCount": self.raw_count,
            "selectedCount": self.selected_count,
            "selectedStartIndex": min(self.selected_indices),
            "selectedEndIndex": max(self.selected_indices),
            "selectedIndices": self.selected_indices,
            "selectedPositions": [round(value, 3) for value in self.positions],
            "candidateWindowCount": self.candidate_count,
            "filtered": self.filtered,
            "bestScore": round(self.score, 6),
            "runnerUpScore": None if self.runner_up_score is None else round(self.runner_up_score, 6),
            "scoreMargin": None if self.score_margin is None else round(self.score_margin, 6),
            "ambiguous": self.ambiguous,
            "topCandidates": self.top_candidates,
        }


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
    if axis == 0:
        projection = np.count_nonzero(mask, axis=0).astype(np.float64)
        denominator = max(1, mask.shape[0])
    else:
        projection = np.count_nonzero(mask, axis=1).astype(np.float64)
        denominator = max(1, mask.shape[1])
    normalized = projection / denominator
    indices = np.flatnonzero(normalized >= threshold)
    centers = _cluster_positions(indices, projection, gap)
    coverage = [
        float(normalized[min(len(normalized) - 1, max(0, int(round(center))))])
        for center in centers
    ]
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


def _top_candidate_payload(
    candidates: list[tuple[float, list[int]]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    return [
        {
            "score": round(score, 6),
            "indices": indices,
            "startIndex": min(indices),
            "endIndex": max(indices),
            "count": len(indices),
        }
        for score, indices in candidates[:limit]
    ]


def _select_vertical_lines(
    positions: list[float],
    coverages: list[float],
    expected_count: int,
    config: GridDetectionConfig,
) -> _AxisSelection:
    if len(positions) < expected_count:
        raise GridDetectionError(
            f"网格竖线不足：需要 {expected_count} 条边界，实际检测到 {len(positions)} 条"
        )
    index_sets = list(combinations(range(len(positions)), expected_count))
    if len(index_sets) > 5000:
        raise GridDetectionError(
            f"竖线候选过多：{len(positions)} 条候选产生 {len(index_sets)} 种组合，无法可靠确定标准网格"
        )
    candidates: list[tuple[float, list[int]]] = []
    for index_tuple in index_sets:
        indices = list(index_tuple)
        candidate = [positions[index] for index in indices]
        candidate_coverage = [coverages[index] for index in indices]
        spacings = np.diff(np.asarray(candidate, dtype=np.float64))
        weekday_spacings = spacings[1:]
        if len(weekday_spacings) != expected_count - 2 or float(np.median(weekday_spacings)) <= 0:
            continue
        weekday_regularity = _regularity(candidate, skip_first_spacing=True)
        time_ratio = float(spacings[0] / np.median(weekday_spacings))
        time_score = max(0.0, 1.0 - abs(time_ratio - 0.56) / 0.56)
        edge_score = float((candidate_coverage[0] + candidate_coverage[-1]) / 2.0)
        skipped_inside = sum(1 for left, right in zip(indices, indices[1:]) if right - left > 1)
        complexity_penalty = min(0.08, skipped_inside * 0.01)
        score = (
            0.45 * weekday_regularity
            + 0.25 * float(np.mean(candidate_coverage))
            + 0.20 * time_score
            + 0.10 * edge_score
            - complexity_penalty
        )
        candidates.append((score, indices))
    if not candidates:
        raise GridDetectionError("无法从竖线候选中确定左侧节次列和 7 个星期列")
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_indices = candidates[0]
    runner = candidates[1][0] if len(candidates) > 1 else None
    margin = None if runner is None else best_score - runner
    ambiguous = margin is not None and margin < config.candidate_warning_margin
    if margin is not None and margin < config.candidate_failure_margin:
        raise GridDetectionError(
            f"竖线候选无法唯一确定：最佳与次佳方案得分差仅 {margin:.4f}"
        )
    return _AxisSelection(
        positions=[positions[index] for index in best_indices],
        coverages=[coverages[index] for index in best_indices],
        score=best_score,
        runner_up_score=runner,
        selected_indices=best_indices,
        selected_count=expected_count,
        raw_count=len(positions),
        candidate_count=len(candidates),
        ambiguous=ambiguous,
        top_candidates=_top_candidate_payload(candidates),
    )


def _select_horizontal_lines(
    positions: list[float],
    coverages: list[float],
    minimum_sections: int,
    maximum_sections: int,
    config: GridDetectionConfig,
) -> tuple[_AxisSelection, int]:
    minimum_count = minimum_sections + 2
    maximum_count = maximum_sections + 2
    if len(positions) < minimum_count:
        raise GridDetectionError(
            f"网格横线不足：至少需要 {minimum_count} 条边界，实际检测到 {len(positions)} 条"
        )
    candidates: list[tuple[float, list[int]]] = []
    for count in range(minimum_count, maximum_count + 1):
        if count > len(positions):
            continue
        for start in range(0, len(positions) - count + 1):
            candidate = positions[start : start + count]
            candidate_coverage = coverages[start : start + count]
            spacings = np.diff(np.asarray(candidate, dtype=np.float64))
            if len(spacings) < 2:
                continue
            row_spacings = spacings[1:]
            mean_row = float(np.mean(row_spacings))
            if mean_row <= 0:
                continue
            row_regularity = max(
                0.0,
                min(1.0, 1.0 - float(np.std(row_spacings) / mean_row) * 2.5),
            )
            header_ratio = float(spacings[0] / mean_row)
            header_score = max(0.0, 1.0 - abs(header_ratio - 1.0))
            edge_score = float((candidate_coverage[0] + candidate_coverage[-1]) / 2.0)
            raw_span = max(1.0, positions[-1] - positions[0])
            span_score = min(1.0, max(0.0, (candidate[-1] - candidate[0]) / raw_span))
            score = (
                0.45 * row_regularity
                + 0.20 * float(np.mean(candidate_coverage))
                + 0.17 * header_score
                + 0.08 * edge_score
                + 0.10 * span_score
            )
            candidates.append((score, list(range(start, start + count))))
    if not candidates:
        raise GridDetectionError("无法从横线候选中确定 10～14 节课的网格")
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_indices = candidates[0]
    best_start = best_indices[0]
    best_count = len(best_indices)
    runner = candidates[1][0] if len(candidates) > 1 else None
    margin = None if runner is None else best_score - runner
    ambiguous = margin is not None and margin < config.candidate_warning_margin
    if (
        margin is not None
        and best_count < len(positions)
        and margin < config.candidate_failure_margin
    ):
        raise GridDetectionError(
            f"横线候选无法唯一确定：最佳与次佳方案得分差仅 {margin:.4f}"
        )
    selection = _AxisSelection(
        positions=positions[best_start : best_start + best_count],
        coverages=coverages[best_start : best_start + best_count],
        score=best_score,
        runner_up_score=runner,
        selected_indices=best_indices,
        selected_count=best_count,
        raw_count=len(positions),
        candidate_count=len(candidates),
        ambiguous=ambiguous,
        top_candidates=_top_candidate_payload(candidates),
    )
    return selection, best_count - 2


def _axis_position_to_original(
    value: float,
    is_vertical: bool,
    working_table: PixelBox,
    inverse: np.ndarray,
) -> float:
    if is_vertical:
        points = np.array(
            [[value, working_table.y], [value, working_table.bottom]],
            dtype=np.float64,
        )
        mapped = transform_points(points, inverse)
        return float(np.mean(mapped[:, 0]))
    points = np.array(
        [[working_table.x, value], [working_table.right, value]],
        dtype=np.float64,
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
        cv2.MORPH_RECT,
        (max(25, width // 24), 1),
    )
    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (1, max(25, height // 24)),
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

    margin = max(2, config.line_cluster_gap)
    x1 = max(0, x - margin)
    y1 = max(0, y - margin)
    x2 = min(width, x + w + margin)
    y2 = min(height, y + h + margin)
    vertical_roi = vertical[y1:y2, x1:x2]
    horizontal_roi = horizontal[y1:y2, x1:x2]
    raw_vertical_positions, raw_vertical_coverage = _line_candidates(
        vertical_roi,
        axis=0,
        threshold=config.vertical_coverage_threshold,
        gap=config.line_cluster_gap,
    )
    raw_horizontal_positions, raw_horizontal_coverage = _line_candidates(
        horizontal_roi,
        axis=1,
        threshold=config.horizontal_coverage_threshold,
        gap=config.line_cluster_gap,
    )
    raw_vertical_positions = [position + x1 for position in raw_vertical_positions]
    raw_horizontal_positions = [position + y1 for position in raw_horizontal_positions]

    expected_vertical_count = config.expected_weekday_columns + 2
    vertical_selection = _select_vertical_lines(
        raw_vertical_positions,
        raw_vertical_coverage,
        expected_vertical_count,
        config,
    )
    horizontal_selection, section_count = _select_horizontal_lines(
        raw_horizontal_positions,
        raw_horizontal_coverage,
        config.minimum_section_rows,
        config.maximum_section_rows,
        config,
    )
    vertical_positions = vertical_selection.positions
    vertical_coverage = vertical_selection.coverages
    horizontal_positions = horizontal_selection.positions
    horizontal_coverage = horizontal_selection.coverages
    if not (config.minimum_section_rows <= section_count <= config.maximum_section_rows):
        raise GridDetectionError("检测到的节次行数不在 10～14 范围内")

    working_table = PixelBox(
        vertical_positions[0],
        horizontal_positions[0],
        vertical_positions[-1] - vertical_positions[0],
        horizontal_positions[-1] - horizontal_positions[0],
    )
    original_table = transform_box(working_table, image.inverse_transform).clipped(
        image.original_width,
        image.original_height,
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
                image.original_width,
                image.original_height,
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
            image.original_width,
            image.original_height,
        )
        section_rows.append(row_original)
        for weekday in range(config.expected_weekday_columns):
            cell_working = PixelBox(
                vertical_positions[weekday + 1],
                horizontal_positions[section + 1],
                vertical_positions[weekday + 2] - vertical_positions[weekday + 1],
                horizontal_positions[section + 2] - horizontal_positions[section + 1],
            )
            cells.append(
                GridCell(
                    weekday=weekday + 1,
                    section=section + 1,
                    working_box=cell_working,
                    original_box=transform_box(cell_working, image.inverse_transform).clipped(
                        image.original_width,
                        image.original_height,
                    ),
                )
            )

    vertical_regularity = _regularity(vertical_positions, skip_first_spacing=True)
    horizontal_regularity = _regularity(horizontal_positions[1:])
    coverage_score = float(np.mean(vertical_coverage + horizontal_coverage))
    confidence = max(
        0.0,
        min(
            1.0,
            0.4 * coverage_score
            + 0.3 * vertical_regularity
            + 0.3 * horizontal_regularity,
        ),
    )
    warnings = list(image.warnings)
    if vertical_selection.filtered:
        warnings.append(
            f"竖线候选从 {vertical_selection.raw_count} 条筛选为 {vertical_selection.selected_count} 条"
        )
        confidence -= config.filtering_confidence_penalty
    if horizontal_selection.filtered:
        warnings.append(
            f"横线候选从 {horizontal_selection.raw_count} 条筛选为 {horizontal_selection.selected_count} 条"
        )
        confidence -= config.filtering_confidence_penalty
    if vertical_selection.ambiguous:
        warnings.append(
            f"竖线最佳与次佳候选得分接近，差值 {vertical_selection.score_margin:.4f}"
        )
        confidence -= config.ambiguity_confidence_penalty
    if horizontal_selection.ambiguous:
        warnings.append(
            f"横线最佳与次佳候选得分接近，差值 {horizontal_selection.score_margin:.4f}"
        )
        confidence -= config.ambiguity_confidence_penalty
    confidence = max(0.0, min(1.0, confidence))
    if confidence < 0.85:
        warnings.append(f"网格检测置信度较低：{confidence:.2f}")
    warnings = list(dict.fromkeys(warnings))

    original_vertical_lines = [
        _axis_position_to_original(value, True, working_table, image.inverse_transform)
        for value in vertical_positions
    ]
    original_horizontal_lines = [
        _axis_position_to_original(value, False, working_table, image.inverse_transform)
        for value in horizontal_positions
    ]
    diagnostics = {
        "vertical": vertical_selection.diagnostics(),
        "horizontal": horizontal_selection.diagnostics(),
    }
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
        candidate_diagnostics=diagnostics,
        horizontal_mask=horizontal,
        vertical_mask=vertical,
    )
