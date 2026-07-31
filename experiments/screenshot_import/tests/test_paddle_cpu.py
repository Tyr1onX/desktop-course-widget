from __future__ import annotations

import sys
import types

from experiments.screenshot_import.paddle_cpu import WindowsCpuPaddleOcrEngine


def test_windows_cpu_engine_disables_mkldnn(monkeypatch):
    captured = {}

    class FakePaddleOCR:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    module = types.ModuleType("paddleocr")
    module.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", module)

    engine = WindowsCpuPaddleOcrEngine(cpu_threads=6)

    assert captured["device"] == "cpu"
    assert captured["enable_mkldnn"] is False
    assert captured["cpu_threads"] == 6
    assert engine.version_info()["enableMkldnn"] == "false"
    assert engine.version_info()["cpuBackend"] == "paddle-no-mkldnn"
