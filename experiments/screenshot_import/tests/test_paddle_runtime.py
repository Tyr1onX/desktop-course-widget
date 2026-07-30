from __future__ import annotations

import os
import types

from experiments.screenshot_import.paddle_runtime import install_mkldnn_safe_constructor


def test_safe_constructor_forces_mkldnn_off(monkeypatch):
    calls = []

    def original(*args, **kwargs):
        calls.append((args, kwargs))
        return kwargs

    module = types.ModuleType("paddleocr")
    module.PaddleOCR = original
    monkeypatch.delenv("FLAGS_use_mkldnn", raising=False)

    install_mkldnn_safe_constructor(module)
    result = module.PaddleOCR("sample", enable_mkldnn=True, lang="ch")

    assert result["enable_mkldnn"] is False
    assert result["lang"] == "ch"
    assert os.environ["FLAGS_use_mkldnn"] == "0"
    assert calls == [(('sample',), {"enable_mkldnn": False, "lang": "ch"})]


def test_safe_constructor_is_idempotent(monkeypatch):
    module = types.ModuleType("paddleocr")
    module.PaddleOCR = lambda **kwargs: kwargs
    monkeypatch.delenv("FLAGS_use_mkldnn", raising=False)

    install_mkldnn_safe_constructor(module)
    wrapped = module.PaddleOCR
    install_mkldnn_safe_constructor(module)

    assert module.PaddleOCR is wrapped
    assert module.PaddleOCR()["enable_mkldnn"] is False
