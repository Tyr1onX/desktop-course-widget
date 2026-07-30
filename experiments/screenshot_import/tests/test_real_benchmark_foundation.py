from __future__ import annotations

import json
from pathlib import Path

import pytest

from experiments.screenshot_import.benchmark import (
    assign_tokens_to_blocks,
    enforce_image_parity_review,
    evaluate_draft,
    validate_confidence_thresholds,
)
from experiments.screenshot_import.cli import main, parser
from experiments.screenshot_import.ground_truth import ground_truth_for, write_ground_truth
from experiments.screenshot_import.models import CourseBlock, OcrToken, ParsedField, PixelBox
from experiments.screenshot_import.ocr import FixtureOcrEngine
from experiments.screenshot_import.pipeline import recognize_image
from experiments.screenshot_import.synthetic import generate_synthetic_sample


def _block(x: float) -> CourseBlock:
    box = PixelBox(x, 0, 100, 100)
    return CourseBlock(1, 1, 1, box, box, 0.95)


@pytest.mark.parametrize(
    ("review", "high"),
    [(-0.01, 0.9), (0.55, 1.01), (0.91, 0.90)],
)
def test_invalid_confidence_thresholds(review: float, high: float):
    with pytest.raises(ValueError, match="0 <= review-confidence"):
        validate_confidence_thresholds(review, high)


@pytest.mark.parametrize(
    ("review", "high"),
    [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.55, 0.90)],
)
def test_valid_confidence_thresholds(review: float, high: float):
    validate_confidence_thresholds(review, high)


def test_cli_defaults_and_ocr_modes():
    defaults = parser().parse_args(["recognize", "--input", "a.png", "--output", "out"])
    assert defaults.review_confidence == 0.55
    assert defaults.high_confidence == 0.90
    assert defaults.ocr_mode == "block"
    assert parser().parse_args(
        ["recognize", "--input", "a.png", "--output", "out", "--ocr-mode", "full"]
    ).ocr_mode == "full"


def test_invalid_cli_thresholds_fail_before_output(tmp_path: Path):
    output = tmp_path / "must-not-exist"
    exit_code = main(
        [
            "recognize",
            "--input",
            str(tmp_path / "missing.png"),
            "--output",
            str(output),
            "--review-confidence",
            "0.9",
            "--high-confidence",
            "0.8",
        ]
    )
    assert exit_code != 0
    assert not output.exists()


def test_full_image_assignment_handles_center_overlap_ambiguity_and_unassigned():
    blocks = [_block(0), _block(100)]
    tokens = [
        OcrToken("left", 0.9, PixelBox(10, 10, 20, 20)),
        OcrToken("right", 0.9, PixelBox(160, 10, 20, 20)),
        OcrToken("outside", 0.9, PixelBox(250, 10, 20, 20)),
        OcrToken("ambiguous", 0.9, PixelBox(90, 10, 20, 20)),
    ]
    result = assign_tokens_to_blocks(tokens, blocks, overlap_threshold=0.4)
    assert [token.text for token in result.by_block[0]] == ["left"]
    assert [token.text for token in result.by_block[1]] == ["right"]
    assert [token.text for token in result.unassigned] == ["outside"]
    assert [item.token.text for item in result.ambiguous] == ["ambiguous"]
    assert result.ambiguous[0].candidate_block_indices == (0, 1)


def test_evaluator_counts_wrong_confirmed_and_rate():
    truth = {
        "source": "synthetic:test",
        "courses": [
            {
                "weekday": 1,
                "startSection": 1,
                "endSection": 2,
                "name": "通信原理",
                "teacher": "张老师",
                "location": "A101",
                "weeks": [1, 2],
                "parity": "odd",
            }
        ],
    }
    values = {
        "weekday": 1,
        "startSection": 1,
        "endSection": 2,
        "name": "通信原理",
        "teacher": "张老师",
        "location": "A101",
        "weeks": [1, 2],
        "parity": "all",
    }
    draft = {
        "courses": [
            {
                **values,
                "review": {
                    "fields": [
                        {"field": field, "status": "confirmed"} for field in values
                    ]
                },
            }
        ]
    }
    result = evaluate_draft(draft, truth)
    assert result["confusion"]["correctConfirmed"] == 7
    assert result["confusion"]["wrongConfirmed"] == 1
    assert result["wrongConfirmedRate"] == pytest.approx(1 / 8)
    assert result["autoConfirmationErrors"][0]["field"] == "parity"
    json.dumps(result, ensure_ascii=False)


def test_image_all_parity_is_not_silently_confirmed():
    fields = {
        "parity": ParsedField(
            field="parity",
            value="all",
            status="confirmed",
            confidence=0.99,
            raw_text="1-8周",
        )
    }
    enforce_image_parity_review(fields)
    assert fields["parity"].status == "review"
    assert "不能自动确认每周" in fields["parity"].reason


def test_ground_truth_is_machine_readable(tmp_path: Path):
    path = write_ground_truth("standard_10", tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload == ground_truth_for("standard_10")
    assert payload["courses"][1]["parity"] == "odd"
    assert payload["courses"][2]["parity"] == "even"


def test_block_and_full_modes_keep_same_flat_field_structure(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path / "samples", "standard_10")
    truth = write_ground_truth("standard_10", tmp_path / "samples")
    reports = {}
    drafts = {}
    for mode in ("block", "full"):
        output = tmp_path / mode
        reports[mode] = recognize_image(
            input_path=sample["image"],
            output_dir=output,
            ocr_engine=FixtureOcrEngine(sample["ocr"]),
            repo_root=tmp_path / "missing-repo",
            ocr_mode=mode,
            ground_truth_path=truth,
        )
        drafts[mode] = json.loads((output / "draft.json").read_text(encoding="utf-8"))
    block_keys = [set(course) - {"review"} for course in drafts["block"]["courses"]]
    full_keys = [set(course) - {"review"} for course in drafts["full"]["courses"]]
    assert block_keys == full_keys
    assert reports["block"]["predictCallCount"] == 5
    assert reports["full"]["predictCallCount"] == 1
    assert reports["block"]["fieldEvaluation"]["counts"]["fieldTotal"] == 40
    assert reports["full"]["fieldEvaluation"]["counts"]["fieldTotal"] == 40
