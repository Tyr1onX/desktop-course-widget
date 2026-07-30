from __future__ import annotations

import json
from pathlib import Path

import pytest

from experiments.screenshot_import.benchmark_io import (
    finalize_benchmark,
    write_benchmark_json,
)


def test_benchmark_json_serialization_and_bootstrap_merge(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    results = tmp_path / "results"
    run_dir = results / "runs" / "standard_10" / "block" / "cold-1"
    run_dir.mkdir(parents=True)
    report_path = run_dir / "report.json"
    report_path.write_text(
        json.dumps({"modelDownloadSeconds": 0, "modelCacheBytes": None}),
        encoding="utf-8",
    )
    benchmark = {
        "schemaVersion": 1,
        "resultKind": "real PaddleOCR benchmark",
        "runs": [],
        "comparisons": [],
        "model": {},
    }
    benchmark_path = write_benchmark_json(results / "benchmark.json", benchmark)
    bootstrap = {
        "cacheBytes": 1234,
        "modelDownloadStartedUtc": "2026-07-30T00:00:00+00:00",
        "modelDownloadEndedUtc": "2026-07-30T00:00:03+00:00",
        "modelDownloadSeconds": 3.0,
        "initializationSeconds": 4.0,
    }
    bootstrap_path = tmp_path / "model-bootstrap.json"
    bootstrap_path.write_text(json.dumps(bootstrap), encoding="utf-8")
    monkeypatch.setenv("GITHUB_SHA", "workflow-event-sha")
    monkeypatch.setenv("BENCHMARK_SOURCE_SHA", "checked-out-source-sha")
    monkeypatch.setenv("GITHUB_RUN_ID", "123")

    finalized = finalize_benchmark(benchmark_path, bootstrap_path)
    assert finalized["model"]["cacheBytes"] == 1234
    assert finalized["model"]["modelDownloadSeconds"] == 3.0
    assert finalized["provenance"]["benchmarkHead"] == "checked-out-source-sha"
    assert finalized["provenance"]["workflowEventSha"] == "workflow-event-sha"
    assert finalized["provenance"]["artifactName"] == (
        "real-paddleocr-benchmark-checked-out-source-sha"
    )
    persisted = json.loads(benchmark_path.read_text(encoding="utf-8"))
    assert persisted == finalized
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["modelDownloadSeconds"] is None
    assert report["modelCacheBytes"] == 1234
    assert "separate bootstrap" in report["metricNotes"]["modelDownloadSeconds"]


def test_benchmark_writer_rejects_missing_required_keys(tmp_path: Path):
    with pytest.raises(ValueError, match="missing required keys"):
        write_benchmark_json(tmp_path / "benchmark.json", {"schemaVersion": 1})
