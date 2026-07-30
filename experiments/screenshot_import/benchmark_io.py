from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_benchmark_json(path: str | Path, payload: dict[str, Any]) -> Path:
    required = {"schemaVersion", "resultKind", "runs", "comparisons"}
    missing = sorted(required.difference(payload))
    if missing:
        raise ValueError(f"benchmark payload is missing required keys: {', '.join(missing)}")
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return target


def finalize_benchmark(
    benchmark_path: str | Path,
    bootstrap_path: str | Path,
) -> dict[str, Any]:
    benchmark_file = Path(benchmark_path)
    bootstrap_file = Path(bootstrap_path)
    benchmark = json.loads(benchmark_file.read_text(encoding="utf-8"))
    bootstrap = json.loads(bootstrap_file.read_text(encoding="utf-8"))
    benchmark["bootstrap"] = bootstrap
    benchmark.setdefault("model", {}).update(
        {
            "cacheBeforeBytes": bootstrap.get("cacheBeforeBytes"),
            "cacheBytes": bootstrap.get("cacheBytes"),
            "cacheRoots": bootstrap.get("cacheRoots"),
            "modelDirectories": bootstrap.get("modelDirectories"),
            "modelDownloadStartedUtc": bootstrap.get("modelDownloadStartedUtc"),
            "modelDownloadEndedUtc": bootstrap.get("modelDownloadEndedUtc"),
            "modelDownloadSeconds": bootstrap.get("modelDownloadSeconds"),
            "bootstrapInitializationSeconds": bootstrap.get("initializationSeconds"),
            "initializationRssMb": bootstrap.get("initializationRssMb"),
            "bootstrapPeakMemoryMb": bootstrap.get("bootstrapPeakMemoryMb"),
            "firstPredictionSeconds": bootstrap.get("firstPredictionSeconds"),
        }
    )
    run_head = os.environ.get("GITHUB_SHA")
    benchmark["provenance"] = {
        "workflowRunId": os.environ.get("GITHUB_RUN_ID"),
        "workflowRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "benchmarkHead": run_head,
        "workflowName": os.environ.get("GITHUB_WORKFLOW"),
        "artifactName": f"real-paddleocr-benchmark-{run_head}" if run_head else None,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
    }
    cache_test = benchmark.get("offlineCacheTest")
    if isinstance(cache_test, dict):
        cache_test["testKind"] = "network-blocked cache reuse test"
        cache_test["limitations"] = (
            "proxy variables pointed to unreachable 127.0.0.1:9 and offline flags were enabled; "
            "this does not prove every physically disconnected environment"
        )
        benchmark["networkBlockedCacheReuseTest"] = dict(cache_test)

    for report_path in benchmark_file.parent.glob("runs/**/report.json"):
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["modelDownloadSeconds"] = None
        report.setdefault("metricNotes", {})["modelDownloadSeconds"] = (
            "model download was measured once in the separate bootstrap stage"
        )
        report["modelCacheBytes"] = bootstrap.get("cacheBytes")
        evaluation = report.get("fieldEvaluation") or {}
        report["unexpectedCourseCount"] = evaluation.get("unexpectedCourseCount", 0)
        report["ambiguousCourseMatches"] = evaluation.get("ambiguousCourseMatches", [])
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    write_benchmark_json(benchmark_file, benchmark)
    return benchmark
