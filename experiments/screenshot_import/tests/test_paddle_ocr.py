from __future__ import annotations

import json
import sys
import types

import numpy as np
import pytest

from experiments.screenshot_import.models import PixelBox
from experiments.screenshot_import.ocr import OcrError, PaddleOcrEngine


class JsonDictResult:
    def __init__(self, payload):
        self.json = payload


class JsonMethodResult:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class ToDictResult:
    def __init__(self, payload):
        self._payload = payload

    def to_dict(self):
        return self._payload


def _engine(monkeypatch, prediction=None, error: Exception | None = None):
    class FakePaddleOCR:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def predict(self, crop):
            assert crop.size > 0
            if error is not None:
                raise error
            return prediction

    module = types.ModuleType("paddleocr")
    module.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", module)
    return PaddleOcrEngine()


def _recognize(monkeypatch, prediction):
    image = np.zeros((200, 300, 3), dtype=np.uint8)
    return _engine(monkeypatch, prediction).recognize(image, PixelBox(100, 50, 80, 60))


def _payload(**overrides):
    value = {
        "rec_texts": ["通信原理"],
        "rec_scores": [0.96],
        "rec_boxes": [[10, 5, 40, 25]],
    }
    value.update(overrides)
    return value


@pytest.mark.parametrize(
    "result",
    [
        JsonDictResult(_payload()),
        JsonMethodResult(_payload()),
        JsonMethodResult(json.dumps(_payload(), ensure_ascii=False)),
        JsonDictResult(json.dumps(_payload(), ensure_ascii=False)),
        ToDictResult(_payload()),
    ],
)
def test_supported_paddle_result_shapes_call_real_recognize(monkeypatch, result):
    tokens = _recognize(monkeypatch, [result])
    assert [(token.text, token.confidence) for token in tokens] == [("通信原理", 0.96)]


def test_predict_can_return_direct_dictionary(monkeypatch):
    tokens = _recognize(monkeypatch, _payload())
    assert [token.text for token in tokens] == ["通信原理"]


def test_numpy_scores_and_rectangular_boxes_are_safe(monkeypatch):
    tokens = _recognize(monkeypatch, [{
        "rec_texts": np.array(["课程甲", "课程乙"], dtype=object),
        "rec_scores": np.array([0.91, 0.82], dtype=np.float32),
        "rec_boxes": np.array([[1, 2, 11, 12], [20, 22, 50, 42]], dtype=np.float32),
    }])
    assert [token.text for token in tokens] == ["课程甲", "课程乙"]
    assert tokens[0].box == PixelBox(101.0, 52.0, 10.0, 10.0)
    assert tokens[1].box == PixelBox(120.0, 72.0, 30.0, 20.0)


def test_numpy_polygon_boxes_are_safe(monkeypatch):
    polygons = np.array([[[2, 3], [22, 3], [22, 13], [2, 13]]], dtype=np.float32)
    tokens = _recognize(monkeypatch, [{
        "rec_texts": np.array(["多边形"], dtype=object),
        "rec_scores": np.array([0.93]),
        "rec_polys": polygons,
    }])
    assert tokens[0].box == PixelBox(102.0, 53.0, 20.0, 10.0)


def test_dt_polys_are_used_when_rec_boxes_and_rec_polys_are_empty(monkeypatch):
    tokens = _recognize(monkeypatch, [{
        "rec_texts": ["检测框"],
        "rec_scores": np.array([0.8]),
        "rec_boxes": np.empty((0, 4), dtype=np.float32),
        "rec_polys": np.empty((0, 4, 2), dtype=np.float32),
        "dt_polys": np.array([[[4, 6], [24, 6], [24, 16], [4, 16]]]),
    }])
    assert tokens[0].box == PixelBox(104.0, 56.0, 20.0, 10.0)


def test_empty_arrays_return_no_tokens(monkeypatch):
    assert _recognize(monkeypatch, [{
        "rec_texts": np.array([], dtype=object),
        "rec_scores": np.array([], dtype=np.float32),
        "rec_boxes": np.empty((0, 4), dtype=np.float32),
    }]) == []


def test_mismatched_counts_use_zero_score_and_region_fallback(monkeypatch):
    tokens = _recognize(monkeypatch, [{
        "rec_texts": ["有框", "无框"],
        "rec_scores": [0.9],
        "rec_boxes": [[5, 5, 15, 15]],
    }])
    by_text = {token.text: token for token in tokens}
    assert by_text["有框"].confidence == 0.9
    assert by_text["无框"].confidence == 0.0
    assert by_text["无框"].box == PixelBox(100.0, 50.0, 80.0, 60.0)


def test_missing_coordinates_use_course_region(monkeypatch):
    tokens = _recognize(monkeypatch, [_payload(rec_boxes=None, rec_polys=None, dt_polys=None)])
    assert tokens[0].box == PixelBox(100.0, 50.0, 80.0, 60.0)


def test_crop_coordinates_are_added_back_to_original_image(monkeypatch):
    tokens = _recognize(monkeypatch, [_payload(rec_boxes=[[10, 5, 40, 25]])])
    assert tokens[0].box == PixelBox(110.0, 55.0, 30.0, 20.0)


def test_empty_text_is_ignored(monkeypatch):
    tokens = _recognize(monkeypatch, [{
        "rec_texts": [" ", "有效"],
        "rec_scores": [0.99, 0.88],
        "rec_boxes": [[0, 0, 5, 5], [5, 5, 15, 15]],
    }])
    assert [token.text for token in tokens] == ["有效"]


def test_unsupported_result_type_raises_ocr_error(monkeypatch):
    with pytest.raises(OcrError, match="Unsupported PaddleOCR result type"):
        _recognize(monkeypatch, [object()])


def test_predict_exception_becomes_clear_ocr_error(monkeypatch):
    engine = _engine(monkeypatch, error=RuntimeError("backend exploded"))
    image = np.zeros((50, 50, 3), dtype=np.uint8)
    with pytest.raises(OcrError, match="PaddleOCR inference failed: backend exploded"):
        engine.recognize(image, PixelBox(0, 0, 20, 20))
