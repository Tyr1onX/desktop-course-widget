from __future__ import annotations

from typing import Any


def _number(value: Any, digits: int = 6) -> str:
    if value is None:
        return "null"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def render_markdown(payload: dict[str, Any]) -> str:
    provenance = payload.get("provenance", {})
    environment = payload.get("environment", {})
    model = payload.get("model", {})
    cache_test = payload.get(
        "networkBlockedCacheReuseTest", payload.get("offlineCacheTest", {})
    )
    lines = [
        "# Real Windows CPU PaddleOCR benchmark",
        "",
        "This report contains real local PaddleOCR results on generated synthetic images. It is not a multi-school accuracy claim and is not connected to the product UI.",
        "",
        "## Reproducibility receipt",
        "",
        f"- Workflow run ID: `{provenance.get('workflowRunId')}`",
        f"- Benchmark HEAD: `{provenance.get('benchmarkHead')}`",
        f"- Workflow: `{provenance.get('workflowName')}`",
        f"- Artifact name: `{provenance.get('artifactName')}`",
        f"- Generated UTC: `{provenance.get('generatedAtUtc')}`",
        "- Artifact ID and GitHub artifact digest are recorded by the canonical PR receipt after upload; they cannot be embedded into the artifact before GitHub assigns them.",
        "",
        "## Environment",
        "",
        f"- Python: `{environment.get('pythonVersion')}`",
        f"- pip: `{environment.get('pipVersion')}`",
        f"- PaddlePaddle: `{environment.get('paddlepaddleVersion')}`",
        f"- PaddleOCR: `{environment.get('paddleocrVersion')}`",
        f"- install seconds: `{_number(environment.get('installSeconds'))}`",
        f"- virtual environment bytes: `{environment.get('venvBytes')}`",
        "",
        "## Model cache",
        "",
        f"- cache bytes: `{model.get('cacheBytes')}`",
        f"- observed cache-write duration: `{_number(model.get('modelDownloadSeconds'))}`",
        f"- first initialization including downloads: `{_number(model.get('bootstrapInitializationSeconds'))}`",
        "",
        "## Network-blocked cache reuse test",
        "",
        f"- success: `{cache_test.get('success')}`",
        f"- initialization seconds: `{_number(cache_test.get('initializationSeconds'))}`",
        f"- token count: `{cache_test.get('tokenCount')}`",
        f"- blocked proxy: `{cache_test.get('networkProxy')}`",
        "",
        "This proves cached initialization and inference while proxy variables point to an unreachable local endpoint and offline flags are enabled. It is not a claim that every physically disconnected environment has been tested.",
        "",
        "## Block versus full-image OCR",
        "",
        "| sample | mode | calls | cold OCR s | hot OCR s | cold pipeline s | hot pipeline s | value correct/total | confirmed/review/missing | unexpected courses | wrong confirmed rate | match ambiguity |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for item in payload.get("comparisons", []):
        evaluation = item.get("fieldEvaluation") or {}
        value = evaluation.get("valueAccuracy") or evaluation.get("counts") or {}
        status = evaluation.get("reviewStatus") or {
            "confirmed": (evaluation.get("counts") or {}).get("confirmed", 0),
            "review": (evaluation.get("counts") or {}).get("review", 0),
            "missing": (evaluation.get("counts") or {}).get("statusMissing", 0),
        }
        correct = value.get("exactlyCorrect", 0) + value.get("normalizedCorrect", 0)
        ambiguity = len(evaluation.get("ambiguousCourseMatches", []))
        lines.append(
            f"| {item.get('sample')} | {item.get('ocrMode')} | {item.get('predictCallCount')} | "
            f"{_number(item.get('coldInferenceSeconds'))} | {_number(item.get('averageHotInferenceSeconds'))} | "
            f"{_number(item.get('coldPipelineSeconds'))} | {_number(item.get('averageHotPipelineSeconds'))} | "
            f"{correct}/{value.get('fieldTotal', 0)} | "
            f"{status.get('confirmed', 0)}/{status.get('review', 0)}/{status.get('missing', 0)} | "
            f"{evaluation.get('unexpectedCourseCount', 0)} | "
            f"{evaluation.get('wrongConfirmedRate')} | {ambiguity} |"
        )
    lines.extend(
        [
            "",
            "## Evaluation semantics",
            "",
            "- `valueAccuracy` measures value comparison: exact, normalized-correct, wrong, or value-missing.",
            "- `reviewStatus` independently counts confirmed, review, and missing evidence states.",
            "- An optional empty truth and empty prediction can be normalized-correct while its review status remains missing.",
            "- Every unmatched predicted course is a false positive. Its confirmed fields are added to `autoConfirmationErrors` and the numerator of `wrongConfirmedRate`.",
            "- Course matching uses connected-component global maximum matching. Equal optimal assignments are emitted as `ambiguousCourseMatches` rather than silently treated as unique.",
            "",
            "## Result structure",
            "",
            "The machine-readable benchmark contains type names, public member names, payload keys, shapes and dtypes. Image pixels, model files, caches and virtual environments are not included.",
            "",
            "## Safety conclusion",
            "",
            "Image-source parity `all` is forced to review unless an explicit odd/even marker was recognized. Threshold changes are not promoted to product policy from two synthetic samples.",
        ]
    )
    return "\n".join(lines) + "\n"
