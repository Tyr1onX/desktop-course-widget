from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

from experiments.screenshot_import.ocr import FixtureOcrEngine
from experiments.screenshot_import.ocr_first_pipeline import recognize_ocr_first_image
from experiments.screenshot_import.synthetic_chinese_corpus import (
    generate_chinese_timetable_corpus,
    generate_chinese_timetable_sample,
    style_names,
    styles,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_chinese_corpus_covers_three_distinct_visual_families() -> None:
    catalog = styles()
    assert style_names() == ("dense_export_12", "minimal_lines_10", "mobile_cards_12")
    assert {style.visual for style in catalog.values()} == {"cards", "minimal", "dense"}
    assert all(len(style.courses) == 4 for style in catalog.values())
    assert any(course.parity == "odd" for style in catalog.values() for course in style.courses)
    assert any(course.parity == "even" for style in catalog.values() for course in style.courses)
    assert any(not course.teacher for style in catalog.values() for course in style.courses)
    assert any(not course.location for style in catalog.values() for course in style.courses)
    assert any(course.joined_location_line for style in catalog.values() for course in style.courses)


def test_generation_is_deterministic_and_tokens_stay_inside_image(tmp_path: Path) -> None:
    first = generate_chinese_timetable_corpus(tmp_path / "first")
    second = generate_chinese_timetable_corpus(tmp_path / "second")
    assert list(first) == list(style_names())

    for style_name in style_names():
        first_paths = first[style_name]
        second_paths = second[style_name]
        for key in ("image", "ocr", "groundTruth"):
            assert _sha256(first_paths[key]) == _sha256(second_paths[key])

        with Image.open(first_paths["image"]) as image:
            width, height = image.size
        fixture = json.loads(first_paths["ocr"].read_text(encoding="utf-8"))
        truth = json.loads(first_paths["groundTruth"].read_text(encoding="utf-8"))
        assert fixture["name"] == style_name
        assert len(truth["courses"]) == 4
        assert len(fixture["tokens"]) >= 7 + styles()[style_name].section_count
        for token in fixture["tokens"]:
            box = token["box"]
            assert 0 <= box["x"] < width
            assert 0 <= box["y"] < height
            assert box["width"] > 0
            assert box["height"] > 0
            assert box["x"] + box["width"] <= width
            assert box["y"] + box["height"] <= height


def test_each_style_round_trips_through_ocr_first_with_exact_fields(tmp_path: Path) -> None:
    for style_name in style_names():
        generated = generate_chinese_timetable_sample(tmp_path / "samples", style_name)
        report = recognize_ocr_first_image(
            input_path=generated["image"],
            output_dir=tmp_path / "results" / style_name,
            ocr_engine=FixtureOcrEngine(generated["ocr"]),
            repo_root=tmp_path / "no-rust-project",
            ground_truth_path=generated["groundTruth"],
        )
        evaluation = report["fieldEvaluation"]
        assert report["success"] is True
        assert report["recognitionStrategy"] == "ocr-first"
        assert report["courseCount"] == 4
        assert evaluation["courseCountExpected"] == 4
        assert evaluation["courseCountPredicted"] == 4
        assert evaluation["courseCountMatched"] == 4
        assert evaluation["missingCourseCount"] == 0
        assert evaluation["falsePositiveCourseCount"] == 0
        assert evaluation["ambiguousCourseMatches"] == []
        assert evaluation["autoConfirmationErrors"] == []
        assert evaluation["valueAccuracy"]["wrong"] == 0
        assert evaluation["valueAccuracy"]["valueMissing"] == 0
        assert (
            evaluation["valueAccuracy"]["exactlyCorrect"]
            + evaluation["valueAccuracy"]["normalizedCorrect"]
            == evaluation["valueAccuracy"]["fieldTotal"]
        )
        assert report["rustValidation"]["available"] is False
