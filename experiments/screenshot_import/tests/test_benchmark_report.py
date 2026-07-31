from __future__ import annotations

import json
from pathlib import Path

from experiments.screenshot_import.benchmark_io import finalize_benchmark
from experiments.screenshot_import.benchmark_report import render_markdown


def test_finalized_benchmark_records_source_head_and_cache_test_semantics(
    tmp_path: Path, monkeypatch
):
    results = tmp_path / "results"
    results.mkdir()
    (results / "benchmark.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "resultKind": "real PaddleOCR benchmark",
                "runs": [],
                "comparisons": [],
                "model": {},
                "offlineCacheTest": {
                    "success": True,
                    "networkProxy": "127.0.0.1:9",
                    "initializationSeconds": 1.2,
                    "tokenCount": 37,
                },
            }
        ),
        encoding="utf-8",
    )
    bootstrap = tmp_path / "bootstrap.json"
    bootstrap.write_text(json.dumps({"cacheBytes": 123}), encoding="utf-8")
    monkeypatch.setenv("GITHUB_SHA", "merge-sha")
    monkeypatch.setenv("BENCHMARK_SOURCE_SHA", "head-sha")
    monkeypatch.setenv("GITHUB_RUN_ID", "12345")
    monkeypatch.setenv("GITHUB_WORKFLOW", "Real PaddleOCR Benchmark")

    payload = finalize_benchmark(results / "benchmark.json", bootstrap)

    assert payload["provenance"]["benchmarkHead"] == "head-sha"
    assert payload["provenance"]["workflowEventSha"] == "merge-sha"
    cache_test = payload["networkBlockedCacheReuseTest"]
    assert cache_test["testKind"] == "network-blocked cache reuse test"
    assert "does not prove" in cache_test["limitations"]


def test_markdown_distinguishes_value_status_unexpected_and_ambiguity():
    payload = {
        "provenance": {
            "workflowRunId": "12345",
            "benchmarkHead": "head-sha",
            "workflowName": "Real PaddleOCR Benchmark",
            "artifactName": "real-paddleocr-benchmark-head-sha",
            "generatedAtUtc": "2026-07-30T00:00:00+00:00",
        },
        "environment": {
            "pythonVersion": "3.13.14",
            "paddlepaddleVersion": "3.3.1",
            "paddleocrVersion": "3.7.0",
        },
        "model": {},
        "networkBlockedCacheReuseTest": {
            "success": True,
            "networkProxy": "127.0.0.1:9",
        },
        "comparisons": [
            {
                "sample": "standard_10",
                "ocrMode": "block",
                "predictCallCount": 5,
                "coldInferenceSeconds": 1.0,
                "averageHotInferenceSeconds": 0.8,
                "coldPipelineSeconds": 1.4,
                "averageHotPipelineSeconds": 1.1,
                "fieldEvaluation": {
                    "valueAccuracy": {
                        "fieldTotal": 40,
                        "exactlyCorrect": 39,
                        "normalizedCorrect": 1,
                    },
                    "reviewStatus": {
                        "confirmed": 35,
                        "review": 4,
                        "missing": 1,
                    },
                    "unexpectedCourseCount": 0,
                    "wrongConfirmedRate": 0.0,
                    "ambiguousCourseMatches": [],
                },
            }
        ],
    }

    markdown = render_markdown(payload)

    assert "valueAccuracy" in markdown
    assert "reviewStatus" in markdown
    assert "unexpected" in markdown
    assert "ambiguousCourseMatches" in markdown
    assert "physically disconnected" in markdown
    assert "40/40" in markdown
