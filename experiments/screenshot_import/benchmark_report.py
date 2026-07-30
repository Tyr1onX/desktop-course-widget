from __future__ import annotations

from typing import Any


def _number(value: Any, digits: int = 6) -> str:
    if value is None:
        return "null"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def _shape_text(value: Any) -> str:
    if not isinstance(value, dict):
        return "unknown"
    parts = [str(value.get("type", "unknown"))]
    if "length" in value:
        parts.append(f"length={value['length']}")
    if "shape" in value:
        parts.append(f"shape={value['shape']}")
    if "dtype" in value:
        parts.append(f"dtype={value['dtype']}")
    return ", ".join(parts)


def _representative_comparisons(payload: dict[str, Any]) -> list[dict[str, Any]]:
    comparisons = payload.get("comparisons", [])
    block = [item for item in comparisons if item.get("ocrMode") == "block"]
    return block or comparisons


def render_markdown(payload: dict[str, Any]) -> str:
    provenance = payload.get("provenance", {})
    environment = payload.get("environment", {})
    model = payload.get("model", {})
    cache_test = payload.get(
        "networkBlockedCacheReuseTest", payload.get("offlineCacheTest", {})
    )
    structure = payload.get("predictionStructure", {})
    structure_items = structure.get("items", []) if isinstance(structure, dict) else []
    first_structure = structure_items[0] if structure_items else {}
    structure_fields = first_structure.get("fields", {}) if isinstance(first_structure, dict) else {}
    wheel = environment.get("paddleWheel", {}) if isinstance(environment.get("paddleWheel"), dict) else {}

    lines = [
        "# Real Windows CPU PaddleOCR benchmark",
        "",
        "This report contains real local PaddleOCR results on generated synthetic images. It is not a multi-school accuracy claim and is not connected to the product UI.",
        "",
        "## Reproducibility receipt",
        "",
        f"- Workflow run ID: `{provenance.get('workflowRunId')}`",
        f"- Benchmark HEAD: `{provenance.get('benchmarkHead')}`",
        f"- Workflow event SHA: `{provenance.get('workflowEventSha')}`",
        f"- Workflow: `{provenance.get('workflowName')}`",
        f"- Artifact name: `{provenance.get('artifactName')}`",
        f"- Generated UTC: `{provenance.get('generatedAtUtc')}`",
        "- Artifact ID and GitHub artifact digest are recorded by the canonical PR receipt after upload; GitHub assigns them only after the artifact contents have already been finalized.",
        "",
        "## Environment and installation",
        "",
        f"- Operating system: `{environment.get('operatingSystem')}`",
        f"- Architecture: `{environment.get('architecture')}`",
        f"- Python: `{environment.get('pythonVersion')}`",
        f"- pip: `{environment.get('pipVersion')}`",
        f"- PaddlePaddle: `{environment.get('paddlepaddleVersion')}`",
        f"- PaddleOCR: `{environment.get('paddleocrVersion')}`",
        f"- Paddle wheel: `{wheel.get('wheelName')}`",
        f"- Paddle wheel bytes: `{wheel.get('wheelBytes')}`",
        f"- install seconds: `{_number(environment.get('installSeconds'))}`",
        f"- virtual environment bytes: `{environment.get('venvBytes')}`",
        "",
        "## Model cache",
        "",
        f"- cache bytes: `{model.get('cacheBytes')}`",
        f"- observed cache-write duration: `{_number(model.get('modelDownloadSeconds'))}`",
        f"- first initialization including downloads: `{_number(model.get('bootstrapInitializationSeconds'))}`",
        f"- initialization RSS MB: `{_number(model.get('initializationRssMb'), 3)}`",
        f"- bootstrap peak memory MB: `{_number(model.get('bootstrapPeakMemoryMb'), 3)}`",
        f"- first prediction seconds: `{_number(model.get('firstPredictionSeconds'))}`",
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
        "## Real PaddleOCR return structure",
        "",
        f"- prediction type: `{structure.get('predictionType')}`",
        f"- top-level container: `{structure.get('topLevelContainerType')}`",
        f"- item count: `{structure.get('itemCount')}`",
        f"- first item type: `{first_structure.get('type')}`",
        f"- `.json` present/callable/type: `{(first_structure.get('json') or {}).get('present')}` / `{(first_structure.get('json') or {}).get('callable')}` / `{(first_structure.get('json') or {}).get('attributeType')}`",
        f"- `to_dict()` callable: `{first_structure.get('toDictCallable')}`",
        f"- `rec_texts`: `{_shape_text(structure_fields.get('rec_texts'))}`",
        f"- `rec_scores`: `{_shape_text(structure_fields.get('rec_scores'))}`",
        f"- `rec_boxes`: `{_shape_text(structure_fields.get('rec_boxes'))}`",
        f"- `rec_polys`: `{_shape_text(structure_fields.get('rec_polys'))}`",
        f"- `dt_polys`: `{_shape_text(structure_fields.get('dt_polys'))}`",
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
            "## Field evaluation by sample",
            "",
            "The following uses one block-mode comparison per sample because block and full are evaluated separately above.",
            "",
            "| sample | expected/predicted/matched | exact | normalized | wrong | value missing | confirmed | review | status missing | unexpected | wrong confirmed | wrong confirmed rate | ambiguous matches |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for item in _representative_comparisons(payload):
        evaluation = item.get("fieldEvaluation") or {}
        value = evaluation.get("valueAccuracy") or {}
        status = evaluation.get("reviewStatus") or {}
        confusion = evaluation.get("confusion") or {}
        lines.append(
            f"| {item.get('sample')} | "
            f"{evaluation.get('courseCountExpected', 0)}/{evaluation.get('courseCountPredicted', 0)}/{evaluation.get('courseCountMatched', 0)} | "
            f"{value.get('exactlyCorrect', 0)} | {value.get('normalizedCorrect', 0)} | "
            f"{value.get('wrong', 0)} | {value.get('valueMissing', 0)} | "
            f"{status.get('confirmed', 0)} | {status.get('review', 0)} | {status.get('missing', 0)} | "
            f"{evaluation.get('unexpectedCourseCount', 0)} | {confusion.get('wrongConfirmed', 0)} | "
            f"{evaluation.get('wrongConfirmedRate')} | {len(evaluation.get('ambiguousCourseMatches', []))} |"
        )

    lines.extend(["", "## Odd/even-week audit", ""])
    parity_rows = []
    for item in _representative_comparisons(payload):
        evaluation = item.get("fieldEvaluation") or {}
        for field in evaluation.get("fields", []):
            if field.get("field") == "parity" and field.get("origin") == "matchedCourse":
                parity_rows.append(
                    (
                        item.get("sample"),
                        field.get("truthCourseIndex"),
                        field.get("expected"),
                        field.get("actual"),
                        field.get("status"),
                        field.get("classification"),
                    )
                )
    if parity_rows:
        lines.extend(
            [
                "| sample | truth course | expected | actual | review status | classification |",
                "|---|---:|---|---|---|---|",
            ]
        )
        for row in parity_rows:
            lines.append(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | {row[5]} |")
    else:
        lines.append("No parity field evaluation was available.")

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
            "## Artifact contents and safety conclusion",
            "",
            "The machine-readable benchmark contains type names, public member names, payload keys, shapes, dtypes, sanitized JSON reports and logs. Image pixels, model files, caches and virtual environments are not included.",
            "",
            "Image-source parity `all` is forced to review unless an explicit odd/even marker was recognized. Threshold changes are not promoted to product policy from two synthetic samples.",
        ]
    )
    return "\n".join(lines) + "\n"
