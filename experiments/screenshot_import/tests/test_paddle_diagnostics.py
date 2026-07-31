from __future__ import annotations

import sys
import types

import numpy as np

from experiments.screenshot_import.models import PixelBox
from experiments.screenshot_import.ocr import PaddleOcrEngine


def test_real_recognize_records_shapes_types_and_each_inference(monkeypatch):
    payload = {
        "rec_texts": np.array(["通信原理"], dtype=object),
        "rec_scores": np.array([0.96], dtype=np.float32),
        "rec_boxes": np.array([[1, 2, 30, 20]], dtype=np.float32),
        "rec_polys": np.empty((0, 4, 2), dtype=np.float32),
        "dt_polys": np.empty((0, 4, 2), dtype=np.float32),
    }

    class FakePaddleOCR:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def predict(self, crop):
            assert crop.size > 0
            return [payload]

    module = types.ModuleType("paddleocr")
    module.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", module)

    engine = PaddleOcrEngine()
    image = np.zeros((80, 120, 3), dtype=np.uint8)
    engine.recognize(image, PixelBox(10, 10, 80, 50))
    engine.recognize(image, PixelBox(10, 10, 80, 50))

    runtime = engine.runtime_info()
    assert runtime["inferenceCalls"] == 2
    assert len(runtime["inferenceDurationsSeconds"]) == 2
    assert runtime["maximumInferenceSeconds"] >= 0

    structure = engine.diagnostics()["resultStructure"]
    assert structure["predictionType"] == "builtins.list"
    item = structure["items"][0]
    assert item["type"] == "builtins.dict"
    assert item["fields"]["rec_scores"]["shape"] == [1]
    assert item["fields"]["rec_scores"]["dtype"] == "float32"
    assert item["fields"]["rec_boxes"]["shape"] == [1, 4]
