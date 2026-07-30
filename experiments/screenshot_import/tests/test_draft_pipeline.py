from __future__ import annotations

import json
from pathlib import Path

from experiments.screenshot_import.ocr import FixtureOcrEngine
from experiments.screenshot_import.pipeline import recognize_image
from experiments.screenshot_import.synthetic import generate_synthetic_sample


def test_mock_pipeline_outputs_import_draft_v2_and_debug_files(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path / "samples", "standard_10")
    output = tmp_path / "output"
    report = recognize_image(
        input_path=sample["image"],
        output_dir=output,
        ocr_engine=FixtureOcrEngine(sample["ocr"]),
        repo_root=tmp_path / "missing-repo",
    )
    for name in ["draft.json", "grid.json", "ocr.json", "overlay.png", "report.json"]:
        assert (output / name).exists()
    draft = json.loads((output / "draft.json").read_text(encoding="utf-8"))
    assert draft["schemaVersion"] == 1
    assert draft["source"] == "image"
    assert draft["imageSource"]["weekdayColumns"] == 7
    assert draft["imageSource"]["sectionRows"] == 10
    assert len(draft["courses"]) == 5
    first = draft["courses"][0]
    assert first["name"] == "通信原理"
    assert first["weekday"] == 1
    assert first["startSection"] == 1
    assert first["endSection"] == 2
    assert first["review"]["sourceBox"]["x"] >= 0
    assert first["review"]["sourceBox"]["x"] + first["review"]["sourceBox"]["width"] <= 1.000001
    evidence = {item["field"]: item for item in first["review"]["fields"]}
    assert evidence["name"]["rawText"] == "通信原理"
    assert evidence["weekday"]["rawText"] == "网格结构定位"
    assert report["rustValidation"]["available"] is False


def test_high_and_low_confidence_statuses_stay_separate_from_final_values(tmp_path: Path):
    sample = generate_synthetic_sample(tmp_path / "samples", "standard_10")
    fixture = json.loads(sample["ocr"].read_text(encoding="utf-8"))
    fixture["tokens"][0]["confidence"] = 0.62
    sample["ocr"].write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")
    output = tmp_path / "output"
    recognize_image(input_path=sample["image"], output_dir=output, ocr_engine=FixtureOcrEngine(sample["ocr"]), repo_root=tmp_path / "none")
    draft = json.loads((output / "draft.json").read_text(encoding="utf-8"))
    first = draft["courses"][0]
    assert first["name"] == "通信原理"
    name_evidence = next(item for item in first["review"]["fields"] if item["field"] == "name")
    assert name_evidence["status"] == "review"
    assert "低于自动确认阈值" in name_evidence["reason"]
