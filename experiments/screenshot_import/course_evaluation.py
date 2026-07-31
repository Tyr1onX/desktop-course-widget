from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any

EVALUATED_FIELDS = (
    "weekday", "startSection", "endSection", "name",
    "teacher", "location", "weeks", "parity",
)
MATCH_STRUCTURE_FIELDS = ("weekday", "startSection", "endSection")


def _normalize_text(value: Any) -> str:
    return re.sub(r"[\s，,。；;：:（）()\-—_]+", "", "" if value is None else str(value)).lower()


def _normalized(field_name: str, value: Any) -> Any:
    if field_name == "weeks":
        try:
            return tuple(sorted(int(item) for item in (value or [])))
        except (TypeError, ValueError):
            return ()
    if field_name in MATCH_STRUCTURE_FIELDS:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if field_name == "parity":
        return str(value or "").lower()
    return _normalize_text(value)


def _review_status(course: dict[str, Any], field_name: str) -> str:
    review = course.get("review") if isinstance(course, dict) else None
    fields = review.get("fields") if isinstance(review, dict) else None
    if isinstance(fields, list):
        for item in fields:
            if isinstance(item, dict) and item.get("field") == field_name:
                status = str(item.get("status", "review"))
                return status if status in {"confirmed", "review", "missing"} else "review"
    return "missing" if course.get(field_name) in (None, "", []) else "review"


def _fingerprint(course: dict[str, Any]) -> tuple[str, ...]:
    return tuple(repr(_normalized(field, course.get(field))) for field in EVALUATED_FIELDS)


def _pair_score(truth: dict[str, Any], predicted: dict[str, Any]) -> int:
    structure_matches = sum(
        _normalized(field, predicted.get(field)) == _normalized(field, truth.get(field))
        for field in MATCH_STRUCTURE_FIELDS
    )
    truth_name = _normalize_text(truth.get("name"))
    predicted_name = _normalize_text(predicted.get("name"))
    name_exact = bool(truth_name) and truth_name == predicted_name
    similarity = (
        SequenceMatcher(None, truth_name, predicted_name).ratio()
        if truth_name and predicted_name else 0.0
    )
    eligible = (
        structure_matches == 3
        or (structure_matches >= 2 and similarity >= 0.25)
        or (structure_matches >= 1 and name_exact)
    )
    if not eligible:
        return 0
    return structure_matches * 100 + (60 if structure_matches == 3 else 0) + (
        100 if name_exact else round(similarity * 50)
    )


@dataclass
class CourseMatchingResult:
    predicted_indices: list[int | None]
    unexpected_predicted_indices: list[int]
    ambiguous_matches: list[dict[str, Any]]
    optimal_score: int
    algorithm: str = "connected-component global maximum matching (dynamic programming)"


def _solve_component(
    truth_indices: list[int],
    predicted_indices: list[int],
    pair_scores: dict[tuple[int, int], int],
    predicted_courses: list[dict[str, Any]],
) -> tuple[dict[int, int | None], list[dict[str, Any]], int]:
    truths = sorted(truth_indices)
    predictions = sorted(predicted_indices, key=lambda i: (_fingerprint(predicted_courses[i]), i))
    local = {original: index for index, original in enumerate(predictions)}

    @lru_cache(maxsize=None)
    def solve(position: int, used: int) -> tuple[int, tuple[tuple[int, ...], ...]]:
        if position == len(truths):
            return 0, ((),)
        truth_index = truths[position]
        options = [-1] + [
            local[predicted_index]
            for predicted_index in predictions
            if pair_scores.get((truth_index, predicted_index), 0) > 0
            and not used & (1 << local[predicted_index])
        ]
        best_score = -1
        best: set[tuple[int, ...]] = set()
        for predicted_local in options:
            next_used = used if predicted_local < 0 else used | (1 << predicted_local)
            child_score, child_assignments = solve(position + 1, next_used)
            edge_score = 0 if predicted_local < 0 else pair_scores[
                (truth_index, predictions[predicted_local])
            ]
            total = edge_score + child_score
            if total > best_score:
                best_score, best = total, set()
            if total == best_score:
                best.update((predicted_local, *child) for child in child_assignments)
        key = lambda assignment: tuple(len(predictions) + 1 if x < 0 else x for x in assignment)
        return best_score, tuple(sorted(best, key=key)[:8])

    score, assignments = solve(0, 0)
    canonical = assignments[0]
    selected = {
        truth_index: None if predicted_local < 0 else predictions[predicted_local]
        for truth_index, predicted_local in zip(truths, canonical)
    }
    ambiguous: list[dict[str, Any]] = []
    for position, truth_index in enumerate(truths):
        alternatives = {
            None if assignment[position] < 0 else predictions[assignment[position]]
            for assignment in assignments[1:]
            if assignment[position] != canonical[position]
        }
        if alternatives:
            selected_index = selected[truth_index]
            ambiguous.append({
                "truthCourseIndex": truth_index,
                "selectedPredictedCourseIndex": selected_index,
                "alternativePredictedCourseIndices": sorted(i for i in alternatives if i is not None),
                "includesUnmatchedAlternative": None in alternatives,
                "selectedScore": pair_scores.get((truth_index, selected_index), 0)
                if selected_index is not None else 0,
                "reason": "multiple globally optimal course assignments have the same total score",
            })
    return selected, ambiguous, score


def _match_courses(
    truth_courses: list[dict[str, Any]], predicted_courses: list[dict[str, Any]]
) -> CourseMatchingResult:
    pair_scores: dict[tuple[int, int], int] = {}
    truth_edges = {i: set() for i in range(len(truth_courses))}
    predicted_edges = {i: set() for i in range(len(predicted_courses))}
    for truth_index, truth in enumerate(truth_courses):
        for predicted_index, predicted in enumerate(predicted_courses):
            score = _pair_score(truth, predicted)
            if score > 0:
                pair_scores[(truth_index, predicted_index)] = score
                truth_edges[truth_index].add(predicted_index)
                predicted_edges[predicted_index].add(truth_index)

    matches: list[int | None] = [None] * len(truth_courses)
    ambiguous: list[dict[str, Any]] = []
    optimal_score = 0
    visited_truth: set[int] = set()
    for root in range(len(truth_courses)):
        if root in visited_truth or not truth_edges[root]:
            continue
        component_truth: set[int] = set()
        component_predicted: set[int] = set()
        queue = [root]
        while queue:
            truth_index = queue.pop()
            if truth_index in component_truth:
                continue
            component_truth.add(truth_index)
            visited_truth.add(truth_index)
            for predicted_index in truth_edges[truth_index]:
                if predicted_index not in component_predicted:
                    component_predicted.add(predicted_index)
                    queue.extend(predicted_edges[predicted_index] - component_truth)
        selected, component_ambiguous, component_score = _solve_component(
            list(component_truth), list(component_predicted), pair_scores, predicted_courses
        )
        for truth_index, predicted_index in selected.items():
            matches[truth_index] = predicted_index
        ambiguous.extend(component_ambiguous)
        optimal_score += component_score

    matched = {index for index in matches if index is not None}
    unexpected = [index for index in range(len(predicted_courses)) if index not in matched]
    return CourseMatchingResult(matches, unexpected, ambiguous, optimal_score)


def _missing(value: Any) -> bool:
    return value in (None, "", [])


def evaluate_draft(draft: dict[str, Any], ground_truth: dict[str, Any]) -> dict[str, Any]:
    truth_courses = [item for item in ground_truth.get("courses", []) if isinstance(item, dict)]
    predicted_courses = [item for item in draft.get("courses", []) if isinstance(item, dict)]
    matching = _match_courses(truth_courses, predicted_courses)
    value_accuracy = {
        "fieldTotal": 0, "exactlyCorrect": 0, "normalizedCorrect": 0,
        "wrong": 0, "valueMissing": 0,
    }
    review_status = {"confirmed": 0, "review": 0, "missing": 0}
    confusion = {
        "correctConfirmed": 0, "wrongConfirmed": 0,
        "correctReview": 0, "wrongReview": 0, "statusMissing": 0,
    }
    fields: list[dict[str, Any]] = []
    auto_errors: list[dict[str, Any]] = []

    for truth_index, truth in enumerate(truth_courses):
        predicted_index = matching.predicted_indices[truth_index]
        predicted = predicted_courses[predicted_index] if predicted_index is not None else None
        for field_name in EVALUATED_FIELDS:
            value_accuracy["fieldTotal"] += 1
            expected = truth.get(field_name)
            status = "missing" if predicted is None else _review_status(predicted, field_name)
            actual = None if predicted is None else predicted.get(field_name)
            exact = predicted is not None and actual == expected
            normalized = predicted is not None and not exact and (
                _normalized(field_name, actual) == _normalized(field_name, expected)
            )
            if exact:
                value_classification = "exactlyCorrect"
            elif normalized:
                value_classification = "normalizedCorrect"
            elif predicted is None or _missing(actual):
                value_classification = "valueMissing"
            else:
                value_classification = "wrong"
            value_accuracy[value_classification] += 1
            review_status[status] += 1
            correct = exact or normalized
            if status == "confirmed":
                bucket = "correctConfirmed" if correct else "wrongConfirmed"
            elif status == "review":
                bucket = "correctReview" if correct else "wrongReview"
            else:
                bucket = "statusMissing"
            confusion[bucket] += 1
            detail = {
                "origin": "matchedCourse" if predicted is not None else "missingCourse",
                "truthCourseIndex": truth_index,
                "predictedCourseIndex": predicted_index,
                "field": field_name, "expected": expected, "actual": actual,
                "status": status, "exact": exact, "normalizedCorrect": normalized,
                "valueClassification": value_classification, "classification": bucket,
            }
            fields.append(detail)
            if bucket == "wrongConfirmed":
                auto_errors.append(detail)

    unexpected_courses: list[dict[str, Any]] = []
    unexpected_confirmed = unexpected_review = unexpected_missing = 0
    for predicted_index in matching.unexpected_predicted_indices:
        predicted = predicted_courses[predicted_index]
        course_fields: list[dict[str, Any]] = []
        for field_name in EVALUATED_FIELDS:
            status = _review_status(predicted, field_name)
            actual = predicted.get(field_name)
            review_status[status] += 1
            detail = {
                "origin": "unexpectedCourse", "unexpectedCourse": True,
                "truthCourseIndex": None, "predictedCourseIndex": predicted_index,
                "field": field_name, "expected": None, "actual": actual,
                "status": status, "exact": False, "normalizedCorrect": False,
            }
            if status == "missing":
                unexpected_missing += 1
                confusion["statusMissing"] += 1
                detail.update(valueClassification="notPredicted", classification="statusMissing")
            else:
                value_accuracy["fieldTotal"] += 1
                value_accuracy["wrong"] += 1
                detail["valueClassification"] = "wrong"
                if status == "confirmed":
                    unexpected_confirmed += 1
                    confusion["wrongConfirmed"] += 1
                    detail["classification"] = "wrongConfirmed"
                    auto_errors.append(detail)
                else:
                    unexpected_review += 1
                    confusion["wrongReview"] += 1
                    detail["classification"] = "wrongReview"
            fields.append(detail)
            course_fields.append(detail)
        unexpected_courses.append({
            "predictedCourseIndex": predicted_index,
            "course": {field: predicted.get(field) for field in EVALUATED_FIELDS},
            "confirmedFieldCount": sum(x["classification"] == "wrongConfirmed" for x in course_fields),
            "reviewFieldCount": sum(x["classification"] == "wrongReview" for x in course_fields),
            "missingFieldCount": sum(x["classification"] == "statusMissing" for x in course_fields),
            "fields": course_fields,
        })

    confirmed_total = confusion["correctConfirmed"] + confusion["wrongConfirmed"]
    missing_course_count = sum(index is None for index in matching.predicted_indices)
    counts = {
        "fieldTotal": value_accuracy["fieldTotal"],
        "exactlyCorrect": value_accuracy["exactlyCorrect"],
        "normalizedCorrect": value_accuracy["normalizedCorrect"],
        "wrong": value_accuracy["wrong"],
        "missing": value_accuracy["valueMissing"],
        "confirmed": review_status["confirmed"],
        "review": review_status["review"],
        "statusMissing": review_status["missing"],
    }
    return {
        "groundTruthSource": ground_truth.get("source"),
        "courseCountExpected": len(truth_courses),
        "courseCountPredicted": len(predicted_courses),
        "courseCountMatched": len(truth_courses) - missing_course_count,
        "missingCourseCount": missing_course_count,
        "unexpectedCourseCount": len(unexpected_courses),
        "falsePositiveCourseCount": len(unexpected_courses),
        "unexpectedConfirmedFieldCount": unexpected_confirmed,
        "unexpectedReviewFieldCount": unexpected_review,
        "unexpectedMissingFieldCount": unexpected_missing,
        "unexpectedCourses": unexpected_courses,
        "valueAccuracy": value_accuracy,
        "reviewStatus": review_status,
        "counts": counts,
        "confusion": confusion,
        "metricSemantics": {
            "valueAccuracy.valueMissing": "ground-truth field has no predicted value",
            "reviewStatus.missing": "review evidence marks the field missing, independently of value correctness",
            "counts.missing": "legacy alias of valueAccuracy.valueMissing",
            "counts.statusMissing": "legacy alias of reviewStatus.missing",
        },
        "matching": {
            "algorithm": matching.algorithm,
            "optimalScore": matching.optimal_score,
            "isUnique": not matching.ambiguous_matches,
            "matchedPredictedCourseIndices": matching.predicted_indices,
        },
        "ambiguousCourseMatches": matching.ambiguous_matches,
        "autoConfirmationErrors": auto_errors,
        "wrongConfirmedRate": confusion["wrongConfirmed"] / confirmed_total if confirmed_total else None,
        "fields": fields,
    }
