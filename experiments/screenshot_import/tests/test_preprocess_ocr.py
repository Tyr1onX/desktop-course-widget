from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from experiments.screenshot_import.models import PixelBox
from experiments.screenshot_import.ocr import FixtureOcrEngine
from experiments.screenshot_import.preprocess import ImageReadError, PreprocessConfig, preprocess_image


def test_png_jpg_and_original_dimensions_are_preserved(tmp_path: Path):
    source = np.full((240, 360, 3), 255, dtype=np.uint8)
    cv2.line(source, (20, 20), (340, 20), (0, 0, 0), 2)
    for suffix in [".png", ".jpg", ".jpeg"]:
        path = tmp_path / f"sample{suffix}"
        cv2.imwrite(str(path), source)
        image = preprocess_image(path, PreprocessConfig(scale=0.5, deskew=False))
        assert (image.original_width, image.original_height) == (360, 240)
        assert image.working_bgr.shape[:2] == (120, 180)


def test_exif_orientation_is_applied(tmp_path: Path):
    source = Image.new("RGB", (80, 40), "white")
    exif = source.getexif()
    exif[274] = 6
    path = tmp_path / "rotated.jpg"
    source.save(path, exif=exif)
    image = preprocess_image(path, PreprocessConfig(deskew=False))
    assert (image.original_width, image.original_height) == (40, 80)


def test_unsupported_extension_fails(tmp_path: Path):
    path = tmp_path / "sample.bmp"
    cv2.imwrite(str(path), np.full((20, 20, 3), 255, dtype=np.uint8))
    with pytest.raises(ImageReadError):
        preprocess_image(path)


def test_fixture_ocr_uses_original_coordinates(tmp_path: Path):
    fixture = tmp_path / "ocr.json"
    fixture.write_text(json.dumps({"tokens": [{"text": "通信原理", "confidence": 0.95, "box": {"x": 100, "y": 50, "width": 80, "height": 20}}]}), encoding="utf-8")
    engine = FixtureOcrEngine(fixture)
    image = np.zeros((300, 400, 3), dtype=np.uint8)
    tokens = engine.recognize(image, PixelBox(90, 40, 120, 80))
    assert len(tokens) == 1
    assert tokens[0].box == PixelBox(100, 50, 80, 20)
