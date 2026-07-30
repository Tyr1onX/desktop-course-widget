from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from experiments.screenshot_import.blocks import detect_course_blocks
from experiments.screenshot_import.grid import GridDetectionError, detect_grid
from experiments.screenshot_import.preprocess import PreprocessConfig, preprocess_image
from experiments.screenshot_import.synthetic import generate_synthetic_sample


@pytest.mark.parametrize(
    ("scenario", "sections", "blocks"),
    [("standard_10", 10, 5), ("tilted_12", 12, 4)],
)
def test_detects_standard_grid_and_spanning_blocks(tmp_path: Path, scenario: str, sections: int, blocks: int):
    sample = generate_synthetic_sample(tmp_path, scenario)
    image = preprocess_image(sample["image"], PreprocessConfig(scale=1.0, deskew=True))
    grid = detect_grid(image)
    detected = detect_course_blocks(image, grid)
    assert grid.weekday_count == 7
    assert grid.section_count == sections
    assert len(detected) == blocks
    assert any(block.end_section - block.start_section + 1 >= 2 for block in detected)
    if scenario == "tilted_12":
        assert abs(image.deskew_angle) > 0.2
        assert any(block.end_section - block.start_section + 1 == 3 for block in detected)


def test_detects_different_resolution(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path, "standard_10")
    source = cv2.imread(str(sample["image"]))
    resized = cv2.resize(source, None, fx=0.62, fy=0.62, interpolation=cv2.INTER_AREA)
    resized_path = tmp_path / "resized.jpg"
    cv2.imwrite(str(resized_path), resized)
    grid = detect_grid(preprocess_image(resized_path, PreprocessConfig(scale=1.0)))
    assert (grid.weekday_count, grid.section_count) == (7, 10)


def test_blank_grid_has_no_course_blocks(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path, "standard_10")
    image = cv2.imread(str(sample["image"]))
    # Remove pastel blocks while preserving a synthetic grid by regenerating white interiors.
    # A white image with the same grid lines is sufficient to exercise empty cells.
    gray = np.full_like(image, 255)
    h, w = gray.shape[:2]
    margin, time_width, day_width, header, row = 28, 96, 170, 68, 68
    x_lines = [margin, margin + time_width] + [margin + time_width + i * day_width for i in range(1, 8)]
    y_lines = [margin, margin + header] + [margin + header + i * row for i in range(1, 11)]
    for x in x_lines:
        cv2.line(gray, (x, margin), (x, y_lines[-1]), (65, 75, 85), 2)
    for y in y_lines:
        cv2.line(gray, (margin, y), (x_lines[-1], y), (65, 75, 85), 2)
    path = tmp_path / "blank.png"
    cv2.imwrite(str(path), gray)
    preprocessed = preprocess_image(path)
    grid = detect_grid(preprocessed)
    assert detect_course_blocks(preprocessed, grid) == []


def test_insufficient_grid_fails_explicitly(tmp_path: Path):
    path = tmp_path / "not-a-grid.png"
    cv2.imwrite(str(path), np.full((400, 600, 3), 255, dtype=np.uint8))
    with pytest.raises(GridDetectionError):
        detect_grid(preprocess_image(path))
