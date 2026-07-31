from __future__ import annotations

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
    *,
    name: str,
    weekday: int,
    start: int,
    end: int,
) -> dict[str, object]:
    return {
        "weekday": weekday,
        "startSection": start,
        "endSection": end,
        "name": name,
        "teacher": "张老师",
        "location": "A101",
        "weeks": [1, 2],
        "parity": "odd",
    }


def _predicted(course: dict[str, object]) -> dict[str, object]:
    return {
        **course,
        "review": {
            "fields": [
                {"field": field, "status": "confirmed"}
                for field in FIELDS
            ]
        },
    }


def test_exact_structure_still_matches_when_ocr_name_is_wrong():
    truth = _course(name="通信原理", weekday=3, start=5, end=6)
    predicted = _course(name="通倍原理", weekday=3, start=5, end=6)

    result = evaluate_draft(
        {"courses": [_predicted(predicted)]},
        {"courses": [truth]},
    )

    assert result["courseCountMatched"] == 1
    assert result["unexpectedCourseCount"] == 0
    assert result["matching"]["matchedPredictedCourseIndices"] == [0]
    assert result["valueAccuracy"]["wrong"] == 1
    assert result["confusion"]["wrongConfirmed"] == 1


def test_global_matching_avoids_greedy_local_optimum():
    first_truth = _course(name="同名课程", weekday=1, start=1, end=2)
    second_truth = _course(name="同名课程", weekday=1, start=1, end=3)

    locally_best_for_first = _course(
        name="同名课程", weekday=1, start=1, end=2
    )
    only_other_global_option = _course(
        name="ABCD", weekday=1, start=1, end=2
    )

    result = evaluate_draft(
        {
            "courses": [
                _predicted(locally_best_for_first),
                _predicted(only_other_global_option),
            ]
        },
        {"courses": [first_truth, second_truth]},
    )

    assert result["courseCountMatched"] == 2
    assert result["unexpectedCourseCount"] == 0
    assert result["matching"]["matchedPredictedCourseIndices"] == [1, 0]
    assert result["matching"]["algorithm"].startswith("connected-component global")
