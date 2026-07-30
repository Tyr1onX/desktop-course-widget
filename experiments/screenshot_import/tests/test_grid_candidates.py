from pathlib import Path

import pytest

from experiments.screenshot_import.grid import detect_grid
from experiments.screenshot_import.preprocess import preprocess_image
from experiments.screenshot_import.synthetic import generate_synthetic_sample


@pytest.mark.parametrize(
    ("scenario", "axis"),
    [
        ("double_border_10", "vertical"),
        ("title_decoration_10", "horizontal"),
        ("extra_vertical_10", "vertical"),
    ],
)
def test_grid_candidate_filtering_is_visible_and_keeps_standard_grid(tmp_path: Path, scenario: str, axis: str):
    sample = generate_synthetic_sample(tmp_path, scenario)
    grid = detect_grid(preprocess_image(sample["image"]))
    assert grid.weekday_count == 7
    assert grid.section_count == 10
    diagnostics = grid.candidate_diagnostics[axis]
    assert diagnostics["rawCandidateCount"] > diagnostics["selectedCount"]
    assert diagnostics["filtered"] is True
    assert diagnostics["topCandidates"]
    assert any("候选从" in warning for warning in grid.warnings)
    widths = [column.width for column in grid.weekday_columns]
    assert max(widths) - min(widths) < 5.0


def test_title_decoration_does_not_become_header_boundary(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path, "title_decoration_10")
    grid = detect_grid(preprocess_image(sample["image"]))
    assert grid.original_table_box.y == pytest.approx(36, abs=3)
    assert grid.section_count == 10


def test_extra_vertical_line_does_not_shift_weekdays(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path, "extra_vertical_10")
    grid = detect_grid(preprocess_image(sample["image"]))
    assert grid.original_vertical_lines[0] == pytest.approx(36, abs=3)
    assert grid.original_vertical_lines[1] == pytest.approx(132, abs=3)
    assert grid.weekday_columns[0].x == pytest.approx(132, abs=3)
