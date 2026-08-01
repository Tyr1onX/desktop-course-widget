from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from experiments.screenshot_import.grid import detect_grid
from experiments.screenshot_import.models import PixelBox
from experiments.screenshot_import.ocr_first_pipeline import _optional_grid_geometry_error
from experiments.screenshot_import.preprocess import preprocess_image
from experiments.screenshot_import.synthetic import generate_synthetic_sample


def _grid_with_widths(widths: list[float]):
    x = 0.0
    columns = []
    for width in widths:
        columns.append(PixelBox(x, 0.0, width, 800.0))
        x += width
    return SimpleNamespace(weekday_columns=columns)


def test_regular_synthetic_grid_passes_geometry_guard(tmp_path: Path) -> None:
    sample = generate_synthetic_sample(tmp_path, "standard_10")
    image = preprocess_image(sample["image"])
    grid = detect_grid(image)
    assert _optional_grid_geometry_error(grid, image.original_width) is None


def test_trailing_border_strips_are_not_weekday_columns() -> None:
    grid = _grid_with_widths([310.0, 302.0, 307.0, 305.0, 304.0, 16.0, 12.0])
    error = _optional_grid_geometry_error(grid, 1762)
    assert error is not None
    assert "星期列宽度退化" in error
    assert "最窄列 12.0px" in error


def test_moderate_perspective_width_change_remains_usable() -> None:
    grid = _grid_with_widths([150.0, 142.0, 132.0, 122.0, 111.0, 101.0, 91.0])
    assert _optional_grid_geometry_error(grid, 1024) is None


def test_grid_with_wrong_column_count_is_rejected() -> None:
    error = _optional_grid_geometry_error(_grid_with_widths([120.0] * 6), 900)
    assert error == "网格星期列数量异常：需要 7 列，实际为 6 列"
