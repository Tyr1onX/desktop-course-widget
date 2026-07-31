from __future__ import annotations

import pytest

from experiments.screenshot_import.benchmark import evaluate_draft

FIELDS = (
    "weekday",
    "startSection",
    "endSection",
    "name",
    "teacher",
    "location",
    "weeks",
    "parity",
)


def _course(
    name: str = "通信原理",
    weekday: int = 1,
    start: int = 1,
    end: int = 2,
    **overrides: object,
) -> dict[str, object]:
    value: dict[str, object] = {
        "weekday": weekday,
        "startSection": start,
        "endSection": end,
        "name": name,
        "teacher": "张老师",
        "location": "A101",
        "weeks": [1, 2],
        "parity": "odd",
    }
    value.update(overrides)
    return value


def _predicted(
    value: dict[str, object], statuses: dict[str, str] | None = None
) -> dict[str, object]:
    statuses = statuses or {field: "confirmed" for field in FIELDS}
    return {
        **value,
        "review": {
            "fields": [
                {"field": field, "status": statuses.get(field, "review")}
                for field in FIELDS
            ]
        },
    }


def test_unexpected_confirmed_course_affects_wrong_confirmed_rate():
    truth = {"source": "synthetic:test", "courses": [_course()]}
    draft = {
        "courses": [
            _predicted(_course()),
            _predicted(_course(name="不存在的课程", weekday=5, start=5, end=6)),
        ]
    }

    result = evaluate_draft(draft, truth)

    assert result["unexpectedCourseCount"] == 1
    assert result["falsePositiveCourseCount"] == 1
    assert result["unexpectedConfirmedFieldCount"] == 8
    assert result["confusion"]["wrongConfirmed"] == 8
    assert result["wrongConfirmedRate"] == pytest.approx(8 / 16)
    assert len(result["autoConfirmationErrors"]) == 8
    assert all(
        item["origin"] == "unexpectedCourse"
        for item in result["autoConfirmationErrors"]
    )


def test_unexpected_course_counts_match_expected_and_predicted_totals():
    result = evaluate_draft(
        {
            "courses": [
                _predicted(_course()),
                _predicted(_course(name="额外课程", weekday=4, start=7, end=8)),
            ]
        },
        {"courses": [_course()]},
    )

    assert result["courseCountExpected"] == 1
    assert result["courseCountPredicted"] == 2
    assert result["courseCountMatched"] == 1
    assert result["unexpectedCourseCount"] == 1


def test_unexpected_review_fields_are_counted_as_wrong_review():
    statuses = {field: "review" for field in FIELDS}
    result = evaluate_draft(
        {
            "courses": [
                _predicted(_course()),
                _predicted(
                    _course(name="额外课程", weekday=4, start=7, end=8),
                    statuses,
                ),
            ]
        },
        {"courses": [_course()]},
    )

    assert result["unexpectedReviewFieldCount"] == 8
    assert result["unexpectedConfirmedFieldCount"] == 0
    assert result["confusion"]["wrongReview"] == 8


def test_unexpected_course_partial_missing_is_reported_separately():
    statuses = {field: "review" for field in FIELDS}
    statuses["teacher"] = "missing"
    statuses["location"] = "missing"
    extra = _course(
        name="额外课程",
        weekday=4,
        start=7,
        end=8,
        teacher=None,
        location=None,
    )

    result = evaluate_draft(
        {"courses": [_predicted(_course()), _predicted(extra, statuses)]},
        {"courses": [_course()]},
    )

    assert result["unexpectedReviewFieldCount"] == 6
    assert result["unexpectedMissingFieldCount"] == 2
    assert result["unexpectedCourses"][0]["missingFieldCount"] == 2


def test_optional_empty_value_accuracy_is_separate_from_missing_review_status():
    truth = _course(location="")
    predicted = _course(location=None)
    statuses = {field: "confirmed" for field in FIELDS}
    statuses["location"] = "missing"

    result = evaluate_draft(
        {"courses": [_predicted(predicted, statuses)]},
        {"courses": [truth]},
    )

    assert result["valueAccuracy"]["normalizedCorrect"] == 1
    assert result["valueAccuracy"]["valueMissing"] == 0
    assert result["reviewStatus"]["missing"] == 1
    assert result["counts"]["missing"] == 0
    assert result["counts"]["statusMissing"] == 1
    assert "valueAccuracy.valueMissing" in result["metricSemantics"]
    assert "reviewStatus.missing" in result["metricSemantics"]


def test_prediction_order_does_not_change_matching_result():
    first = _course(name="课程 A", weekday=1, start=1, end=2)
    second = _course(name="课程 B", weekday=2, start=3, end=4)
    truth = {"courses": [first, second]}

    ordered = evaluate_draft(
        {"courses": [_predicted(first), _predicted(second)]}, truth
    )
    reversed_result = evaluate_draft(
        {"courses": [_predicted(second), _predicted(first)]}, truth
    )

    assert ordered["valueAccuracy"] == reversed_result["valueAccuracy"]
    assert ordered["wrongConfirmedRate"] == 0
    assert reversed_result["wrongConfirmedRate"] == 0
    assert ordered["matching"]["isUnique"] is True
    assert reversed_result["matching"]["isUnique"] is True


def test_equal_global_assignments_are_reported_as_ambiguous():
    truth = {
        "courses": [
            _course(name="高等数学 A"),
            _course(name="高等数学 B"),
        ]
    }
    draft = {
        "courses": [
            _predicted(_course(name="高等数学")),
            _predicted(_course(name="高等数学")),
        ]
    }

    result = evaluate_draft(draft, truth)

    assert result["matching"]["isUnique"] is False
    assert result["ambiguousCourseMatches"]
    assert all(
        item["reason"].startswith("multiple globally optimal")
        for item in result["ambiguousCourseMatches"]
    )
