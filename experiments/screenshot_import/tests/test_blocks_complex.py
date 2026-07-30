from pathlib import Path

from experiments.screenshot_import.blocks import detect_course_blocks
from experiments.screenshot_import.grid import detect_grid
from experiments.screenshot_import.preprocess import preprocess_image
from experiments.screenshot_import.parse_fields import parse_course_fields
from experiments.screenshot_import.synthetic import generate_synthetic_sample


def _blocks(tmp_path: Path, scenario: str):
    sample = generate_synthetic_sample(tmp_path, scenario)
    image = preprocess_image(sample["image"])
    grid = detect_grid(image)
    return detect_course_blocks(image, grid)


def test_weak_internal_lines_merge_same_colored_spanning_course_with_review_warning(tmp_path: Path):
    blocks = _blocks(tmp_path, "weak_internal_line_10")
    assert [(b.weekday, b.start_section, b.end_section) for b in blocks] == [(2, 2, 4)]
    assert blocks[0].warnings
    assert any("颜色连续性合并" in warning for warning in blocks[0].warnings)


def test_clear_line_keeps_similar_adjacent_courses_separate(tmp_path: Path):
    blocks = _blocks(tmp_path, "similar_adjacent_10")
    assert [(b.weekday, b.start_section, b.end_section) for b in blocks] == [
        (3, 4, 4),
        (3, 5, 5),
    ]
    assert not any("颜色连续性合并" in warning for block in blocks for warning in block.warnings)


def test_missing_line_with_distinct_colors_stays_split_and_marks_both_sides_for_review(tmp_path: Path):
    blocks = _blocks(tmp_path, "distinct_missing_boundary_10")
    assert [(b.weekday, b.start_section, b.end_section) for b in blocks] == [
        (4, 6, 6),
        (4, 7, 7),
    ]
    assert all(block.warnings for block in blocks)
    assert all(any("边界缺失但相邻颜色差异较大" in w for w in block.warnings) for block in blocks)


def test_ambiguous_boundary_warnings_force_structural_fields_to_review(tmp_path: Path):
    block = _blocks(tmp_path, "weak_internal_line_10")[0]
    fields = parse_course_fields([], block)
    assert fields["weekday"].status == "review"
    assert fields["startSection"].status == "review"
    assert fields["endSection"].status == "review"
    assert "跨节判断需要复核" in (fields["endSection"].reason or "")
