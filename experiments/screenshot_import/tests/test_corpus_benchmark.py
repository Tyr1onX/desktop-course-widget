from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from experiments.screenshot_import.corpus_benchmark import (
    classify_failure,
    collect_corpus_cases,
    run_corpus_benchmark,
)


def _sample(sample_id: str, filename: str, role: str) -> dict:
    return {
        "id": sample_id,
        "title": sample_id.replace("-", " ").title(),
        "filename": filename,
        "sourcePage": f"https://commons.wikimedia.org/wiki/File:{filename}",
        "downloadUrl": f"https://upload.wikimedia.org/wikipedia/commons/0/00/{filename}",
        "sha256": "0" * 64,
        "license": "CC0-1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "author": "Example",
        "attribution": "Example sample, CC0 1.0.",
        "role": role,
        "expectedBehavior": "Recognize or reject safely.",
        "tags": ["weekly-grid" if role != "negative-layout" else "negative"],
    }


def _prepare_corpus(tmp_path: Path) -> tuple[Path, Path]:
    corpus = tmp_path / "corpus"
    raw = corpus / "raw"
    variants = corpus / "variants"
    raw.mkdir(parents=True)
    variants.mkdir(parents=True)

    samples = [
        _sample("positive-sample", "positive.png", "positive-layout"),
        _sample("negative-sample", "negative.png", "negative-layout"),
    ]
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps({"schemaVersion": 1, "samples": samples}, indent=2),
        encoding="utf-8",
    )

    for filename in ("positive.png", "negative.png"):
        Image.new("RGB", (640, 480), "white").save(raw / filename)

    records = []
    for sample_id in ("positive-sample", "negative-sample"):
        sample_dir = variants / sample_id
        sample_dir.mkdir()
        variant_path = sample_dir / "cropped-bottom-8pct.jpg"
        Image.new("RGB", (640, 440), "white").save(variant_path)
        records.append(
            {
                "sourceId": sample_id,
                "variant": "cropped-bottom-8pct",
                "filename": str(variant_path.relative_to(corpus)).replace("\\", "/"),
                "expected": "detect-incomplete-or-review",
            }
        )
    (corpus / "variants.json").write_text(
        json.dumps({"schemaVersion": 1, "variants": records}, indent=2),
        encoding="utf-8",
    )
    return corpus, manifest_path


def _recognized(*, review: int = 1, missing: int = 0) -> dict:
    return {
        "success": True,
        "courseCount": 3,
        "recognitionStrategy": "ocr-first",
        "optionalGridAvailable": False,
        "warnings": [],
        "fieldParsing": {
            "statusCounts": {
                "confirmed": 12,
                "review": review,
                "missing": missing,
            }
        },
        "timings": {"totalPipelineSeconds": 0.25},
    }


def test_collects_originals_before_sorted_variants(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)
    cases = collect_corpus_cases(corpus, manifest_path=manifest)
    assert [case.case_id for case in cases] == [
        "positive-sample::original",
        "positive-sample::cropped-bottom-8pct",
        "negative-sample::original",
        "negative-sample::cropped-bottom-8pct",
    ]


def test_collect_rejects_variant_path_traversal(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)
    payload = json.loads((corpus / "variants.json").read_text(encoding="utf-8"))
    payload["variants"][0]["filename"] = "../escape.jpg"
    (corpus / "variants.json").write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="unsafe corpus variant path"):
        collect_corpus_cases(corpus, manifest_path=manifest)


def test_expected_negative_rejection_passes_gate(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)

    def recognize(path: Path, _output: Path) -> dict:
        if "negative" in path.name or "negative-sample" in str(path):
            raise RuntimeError("整图 OCR 已完成，但未形成课程记录")
        return _recognized()

    report = run_corpus_benchmark(
        corpus,
        tmp_path / "report",
        recognize,
        manifest_path=manifest,
    )
    assert report["gatePassed"] is True
    negative = [
        case for case in report["cases"] if case["role"] == "negative-layout"
    ]
    assert {case["outcome"] for case in negative} == {"expected-rejection"}
    assert (tmp_path / "report" / "corpus-benchmark.json").is_file()
    assert (tmp_path / "report" / "corpus-benchmark.md").is_file()
    stored = json.loads(
        (tmp_path / "report" / "corpus-benchmark.json").read_text(encoding="utf-8")
    )
    assert stored["outputs"]["summary"].endswith("corpus-benchmark.md")


def test_negative_false_positive_fails_gate(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)
    report = run_corpus_benchmark(
        corpus,
        tmp_path / "report",
        lambda _path, _output: _recognized(),
        manifest_path=manifest,
        include_variants=False,
    )
    assert report["gatePassed"] is False
    failed = [case for case in report["cases"] if not case["gatePassed"]]
    assert len(failed) == 1
    assert failed[0]["failureClass"] == "negative-false-positive"


def test_positive_miss_is_observational_until_required(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)

    def miss(_path: Path, _output: Path) -> dict:
        raise RuntimeError("整图 OCR 已完成，但未形成课程记录")

    baseline = run_corpus_benchmark(
        corpus,
        tmp_path / "baseline",
        miss,
        manifest_path=manifest,
        sample_ids=["positive-sample"],
        include_variants=False,
    )
    required = run_corpus_benchmark(
        corpus,
        tmp_path / "required",
        miss,
        manifest_path=manifest,
        sample_ids=["positive-sample"],
        include_variants=False,
        require_positive=True,
    )
    assert baseline["gatePassed"] is True
    assert baseline["cases"][0]["outcome"] == "not-recognized"
    assert required["gatePassed"] is False


def test_incomplete_case_can_be_observational_or_strict(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)

    def fully_confirmed(_path: Path, _output: Path) -> dict:
        return _recognized(review=0, missing=0)

    observational = run_corpus_benchmark(
        corpus,
        tmp_path / "observational",
        fully_confirmed,
        manifest_path=manifest,
        sample_ids=["positive-sample"],
        include_originals=False,
        strict_incomplete=False,
    )
    strict = run_corpus_benchmark(
        corpus,
        tmp_path / "strict",
        fully_confirmed,
        manifest_path=manifest,
        sample_ids=["positive-sample"],
        include_originals=False,
        strict_incomplete=True,
    )
    assert observational["gatePassed"] is True
    assert observational["cases"][0]["outcome"] == "silent-incomplete-recognition"
    assert strict["gatePassed"] is False


def test_cropped_rejection_passes_strict_incomplete(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)

    def reject(_path: Path, _output: Path) -> dict:
        raise RuntimeError("整图 OCR 已完成，但未形成课程记录")

    report = run_corpus_benchmark(
        corpus,
        tmp_path / "strict",
        reject,
        manifest_path=manifest,
        sample_ids=["positive-sample"],
        include_originals=False,
        strict_incomplete=True,
    )
    assert report["gatePassed"] is True
    assert report["cases"][0]["outcome"] == "incomplete-rejection"


def test_pipeline_error_is_classified_and_fails_by_default(tmp_path: Path) -> None:
    corpus, manifest = _prepare_corpus(tmp_path)

    def fail(_path: Path, _output: Path) -> dict:
        raise RuntimeError("unexpected parser crash")

    report = run_corpus_benchmark(
        corpus,
        tmp_path / "report",
        fail,
        manifest_path=manifest,
        sample_ids=["positive-sample"],
        include_variants=False,
    )
    assert report["gatePassed"] is False
    assert report["cases"][0]["failureClass"] == "pipeline-error"
    assert classify_failure("PaddleOCR is not installed") == "ocr-runtime"
    assert classify_failure("operation timed out") == "timeout"
