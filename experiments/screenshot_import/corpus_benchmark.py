from __future__ import annotations

import json
import re
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from .corpus import SCHEMA_VERSION, CorpusSample, load_corpus_manifest, select_samples

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
CASE_COMPONENT_PATTERN = re.compile(r"[^a-zA-Z0-9._-]+")
INCOMPLETE_WARNING_HINTS = (
    "裁切",
    "不完整",
    "截断",
    "图片边缘",
    "缺少星期表头",
    "缺少节次标签",
    "cropped",
    "incomplete",
    "truncated",
    "cut off",
    "missing weekday header",
    "missing section label",
)
RecognizeCase = Callable[[Path, Path], dict[str, Any]]


@dataclass(frozen=True)
class CorpusCase:
    sample_id: str
    title: str
    role: str
    variant: str
    expected: str
    input_path: Path
    tags: tuple[str, ...]

    @property
    def case_id(self) -> str:
        return f"{self.sample_id}::{self.variant}"


def collect_corpus_cases(
    corpus_dir: str | Path,
    *,
    manifest_path: str | Path | None = None,
    sample_ids: Iterable[str] | None = None,
    include_originals: bool = True,
    include_variants: bool = True,
    max_cases: int | None = None,
) -> tuple[CorpusCase, ...]:
    if not include_originals and not include_variants:
        raise ValueError("corpus benchmark must include originals, variants, or both")
    if max_cases is not None and max_cases <= 0:
        raise ValueError("max-cases must be greater than zero")

    root = Path(corpus_dir)
    manifest = load_corpus_manifest(manifest_path)
    selected = select_samples(manifest, sample_ids)
    selected_by_id = {sample.sample_id: sample for sample in selected}
    cases_by_sample: dict[str, list[CorpusCase]] = {
        sample.sample_id: [] for sample in selected
    }

    if include_originals:
        for sample in selected:
            source = root / "raw" / sample.filename
            _require_image(source, root)
            cases_by_sample[sample.sample_id].append(
                _case_from_sample(
                    sample,
                    variant="original",
                    expected=sample.expected_behavior,
                    input_path=source,
                )
            )

    if include_variants:
        variant_index = root / "variants.json"
        if not variant_index.is_file():
            raise FileNotFoundError(
                f"missing corpus variant index {variant_index}; "
                "run build-corpus-variants first"
            )
        payload = json.loads(variant_index.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
            raise ValueError(
                f"corpus variant index schemaVersion must be {SCHEMA_VERSION}"
            )
        raw_variants = payload.get("variants")
        if not isinstance(raw_variants, list):
            raise ValueError("corpus variant index must contain a variants list")

        seen_variant_ids: set[str] = set()
        for index, raw in enumerate(raw_variants):
            if not isinstance(raw, dict):
                raise ValueError(f"variant {index + 1} must be an object")
            source_id = _required_string(raw, "sourceId", index)
            if source_id not in selected_by_id:
                continue
            variant = _required_string(raw, "variant", index)
            filename = _required_string(raw, "filename", index)
            expected = _required_string(raw, "expected", index)
            case_id = f"{source_id}::{variant}"
            if case_id in seen_variant_ids:
                raise ValueError(f"duplicate corpus variant: {case_id}")
            seen_variant_ids.add(case_id)
            source = _resolve_relative_image(root, filename)
            cases_by_sample[source_id].append(
                _case_from_sample(
                    selected_by_id[source_id],
                    variant=variant,
                    expected=expected,
                    input_path=source,
                )
            )

        missing = [
            sample.sample_id
            for sample in selected
            if not any(case.variant != "original" for case in cases_by_sample[sample.sample_id])
        ]
        if missing:
            raise ValueError(
                "variant index has no entries for selected samples: " + ", ".join(missing)
            )

    cases: list[CorpusCase] = []
    seen_case_ids: set[str] = set()
    for sample in selected:
        sample_cases = cases_by_sample[sample.sample_id]
        sample_cases.sort(key=lambda case: (case.variant != "original", case.variant))
        for case in sample_cases:
            if case.case_id in seen_case_ids:
                raise ValueError(f"duplicate corpus case: {case.case_id}")
            seen_case_ids.add(case.case_id)
            cases.append(case)

    if not cases:
        raise ValueError("corpus benchmark selected no cases")
    if max_cases is not None:
        cases = cases[:max_cases]
    return tuple(cases)


def _case_from_sample(
    sample: CorpusSample,
    *,
    variant: str,
    expected: str,
    input_path: Path,
) -> CorpusCase:
    return CorpusCase(
        sample_id=sample.sample_id,
        title=sample.title,
        role=sample.role,
        variant=variant,
        expected=expected,
        input_path=input_path,
        tags=sample.tags,
    )


def _required_string(raw: dict[str, Any], key: str, index: int) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"variant {index + 1} field {key} must be a non-empty string")
    return value.strip()


def _resolve_relative_image(root: Path, filename: str) -> Path:
    relative = Path(filename)
    if relative.is_absolute() or any(part == ".." for part in relative.parts):
        raise ValueError(f"unsafe corpus variant path: {filename}")
    source = root / relative
    return _require_image(source, root)


def _require_image(path: Path, root: Path) -> Path:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise ValueError(f"corpus image escapes corpus directory: {path}") from error
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"unsupported corpus image extension: {path.name}")
    if not path.is_file():
        raise FileNotFoundError(f"missing corpus image: {path}")
    return path


def run_corpus_benchmark(
    corpus_dir: str | Path,
    output_dir: str | Path,
    recognize_case: RecognizeCase,
    *,
    manifest_path: str | Path | None = None,
    sample_ids: Iterable[str] | None = None,
    include_originals: bool = True,
    include_variants: bool = True,
    max_cases: int | None = None,
    fail_on_error: bool = True,
    require_positive: bool = False,
    strict_negative: bool = True,
    strict_incomplete: bool = False,
) -> dict[str, Any]:
    cases = collect_corpus_cases(
        corpus_dir,
        manifest_path=manifest_path,
        sample_ids=sample_ids,
        include_originals=include_originals,
        include_variants=include_variants,
        max_cases=max_cases,
    )
    output = Path(output_dir)
    case_output_root = output / "cases"
    case_output_root.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    for case in cases:
        case_output = case_output_root / _safe_case_directory(case)
        case_output.mkdir(parents=True, exist_ok=True)
        started = time.perf_counter()
        report: dict[str, Any] | None = None
        error: Exception | None = None
        try:
            report = recognize_case(case.input_path, case_output)
            if not isinstance(report, dict):
                raise TypeError("recognizer must return a report object")
        except Exception as caught:
            error = caught
        elapsed = time.perf_counter() - started
        records.append(
            _case_record(
                case,
                report=report,
                error=error,
                elapsed_seconds=elapsed,
                fail_on_error=fail_on_error,
                require_positive=require_positive,
                strict_negative=strict_negative,
                strict_incomplete=strict_incomplete,
            )
        )

    gate_passed = all(bool(record["gatePassed"]) for record in records)
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "corpus-benchmark.json"
    summary_path = output / "corpus-benchmark.md"
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "gatePassed": gate_passed,
        "policy": {
            "failOnError": fail_on_error,
            "requirePositive": require_positive,
            "strictNegative": strict_negative,
            "strictIncomplete": strict_incomplete,
        },
        "summary": _summarize(records),
        "cases": records,
        "outputs": {
            "report": str(report_path),
            "summary": str(summary_path),
            "cases": str(case_output_root),
        },
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary_path.write_text(_markdown_summary(report), encoding="utf-8")
    return report


def _safe_case_directory(case: CorpusCase) -> str:
    value = CASE_COMPONENT_PATTERN.sub("-", case.case_id).strip("-.")
    return value or "case"


def _case_record(
    case: CorpusCase,
    *,
    report: dict[str, Any] | None,
    error: Exception | None,
    elapsed_seconds: float,
    fail_on_error: bool,
    require_positive: bool,
    strict_negative: bool,
    strict_incomplete: bool,
) -> dict[str, Any]:
    incomplete_case = case.expected == "detect-incomplete-or-review"
    if error is not None:
        failure_class = classify_failure(error)
        no_course_records = failure_class == "no-course-records"
        if no_course_records and case.role == "negative-layout":
            outcome = "expected-rejection"
            gate_passed = True
            status = "rejected"
        elif no_course_records and incomplete_case:
            outcome = "incomplete-rejection"
            gate_passed = True
            status = "rejected"
        elif no_course_records:
            outcome = "not-recognized"
            gate_passed = not require_positive
            status = "rejected"
        else:
            outcome = "error"
            gate_passed = not fail_on_error
            status = "error"
        return {
            "id": case.case_id,
            "sourceId": case.sample_id,
            "title": case.title,
            "role": case.role,
            "variant": case.variant,
            "expected": case.expected,
            "tags": list(case.tags),
            "input": str(case.input_path),
            "status": status,
            "outcome": outcome,
            "gatePassed": gate_passed,
            "failureClass": failure_class,
            "errorType": type(error).__name__,
            "error": str(error)[:2000],
            "elapsedSeconds": round(elapsed_seconds, 6),
        }

    assert report is not None
    course_count = _non_negative_int(report.get("courseCount"))
    status_counts = _status_counts(report)
    warnings = report.get("warnings")
    warning_values = (
        [str(warning) for warning in warnings]
        if isinstance(warnings, list)
        else []
    )
    warning_count = len(warning_values)
    incomplete_warning_count = sum(
        _is_incomplete_warning(warning) for warning in warning_values
    )
    recognized = bool(report.get("success")) and course_count > 0
    reviewable = (
        status_counts["review"] > 0
        or status_counts["missing"] > 0
        or incomplete_warning_count > 0
    )

    if not recognized and case.role == "negative-layout":
        outcome = "expected-rejection"
        gate_passed = True
        failure_class = "empty-result"
    elif not recognized and incomplete_case:
        outcome = "incomplete-rejection"
        gate_passed = True
        failure_class = "empty-result"
    elif not recognized:
        outcome = "not-recognized"
        gate_passed = not require_positive
        failure_class = "empty-result"
    elif case.role == "negative-layout":
        outcome = "unexpected-recognition"
        gate_passed = not strict_negative
        failure_class = "negative-false-positive"
    elif incomplete_case and not reviewable:
        outcome = "silent-incomplete-recognition"
        gate_passed = not strict_incomplete
        failure_class = "incomplete-not-flagged"
    elif incomplete_case:
        outcome = "incomplete-reviewable"
        gate_passed = True
        failure_class = None
    else:
        outcome = "recognized"
        gate_passed = True
        failure_class = None

    timings = report.get("timings") if isinstance(report.get("timings"), dict) else {}
    total_pipeline = _finite_number(timings.get("totalPipelineSeconds"))
    return {
        "id": case.case_id,
        "sourceId": case.sample_id,
        "title": case.title,
        "role": case.role,
        "variant": case.variant,
        "expected": case.expected,
        "tags": list(case.tags),
        "input": str(case.input_path),
        "status": "recognized" if recognized else "rejected",
        "outcome": outcome,
        "gatePassed": gate_passed,
        "failureClass": failure_class,
        "courseCount": course_count,
        "fieldStatusCounts": status_counts,
        "warningCount": warning_count,
        "incompleteWarningCount": incomplete_warning_count,
        "recognitionStrategy": report.get("recognitionStrategy"),
        "optionalGridAvailable": report.get("optionalGridAvailable"),
        "pipelineSeconds": total_pipeline,
        "elapsedSeconds": round(elapsed_seconds, 6),
    }


def _is_incomplete_warning(value: str) -> bool:
    normalized = value.casefold()
    return any(hint in normalized for hint in INCOMPLETE_WARNING_HINTS)


def classify_failure(error: Exception | str) -> str:
    message = str(error).casefold()
    if "未形成课程记录" in message or "no course record" in message:
        return "no-course-records"
    if "paddleocr is not installed" in message or "paddleocr initialization failed" in message:
        return "ocr-runtime"
    if "timeout" in message or "timed out" in message:
        return "timeout"
    if "rust importdraft" in message or "structuralvalid" in message:
        return "draft-validation"
    if "invalid image" in message or "cannot identify image" in message:
        return "invalid-image"
    return "pipeline-error"


def _status_counts(report: dict[str, Any]) -> dict[str, int]:
    parsing = report.get("fieldParsing")
    raw = parsing.get("statusCounts") if isinstance(parsing, dict) else None
    if not isinstance(raw, dict):
        raw = {}
    return {
        key: _non_negative_int(raw.get(key))
        for key in ("confirmed", "review", "missing")
    }


def _non_negative_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def _finite_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed in {float("inf"), float("-inf")}:
        return None
    return round(parsed, 6)


def _summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts = Counter(str(record["status"]) for record in records)
    outcome_counts = Counter(str(record["outcome"]) for record in records)
    failure_counts = Counter(
        str(record["failureClass"])
        for record in records
        if record.get("failureClass")
    )
    role_counts = Counter(str(record["role"]) for record in records)
    return {
        "total": len(records),
        "passed": sum(1 for record in records if record["gatePassed"]),
        "failed": sum(1 for record in records if not record["gatePassed"]),
        "statusCounts": dict(sorted(status_counts.items())),
        "outcomeCounts": dict(sorted(outcome_counts.items())),
        "failureClassCounts": dict(sorted(failure_counts.items())),
        "roleCounts": dict(sorted(role_counts.items())),
    }


def _markdown_summary(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Timetable corpus benchmark",
        "",
        f"- Gate: **{'PASS' if report['gatePassed'] else 'FAIL'}**",
        f"- Cases: {summary['total']}",
        f"- Passed: {summary['passed']}",
        f"- Failed: {summary['failed']}",
        "",
        "| Case | Role | Outcome | Courses | Review | Missing | Gate |",
        "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ]
    for record in report["cases"]:
        fields = record.get("fieldStatusCounts") or {}
        lines.append(
            "| {id} | {role} | {outcome} | {courses} | {review} | {missing} | {gate} |".format(
                id=record["id"].replace("|", "\\|"),
                role=record["role"],
                outcome=record["outcome"],
                courses=record.get("courseCount", "-"),
                review=fields.get("review", "-"),
                missing=fields.get("missing", "-"),
                gate="PASS" if record["gatePassed"] else "FAIL",
            )
        )
    return "\n".join(lines) + "\n"
