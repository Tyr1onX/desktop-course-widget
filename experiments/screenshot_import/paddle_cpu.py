from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .ocr import OcrError, PaddleOcrEngine


class WindowsCpuPaddleOcrEngine(PaddleOcrEngine):
    """PaddleOCR adapter for the evidenced Paddle 3.3.1 Windows CPU path."""

    def __init__(
        self,
        *,
        language: str = "ch",
        device: str = "cpu",
        cpu_threads: int = 2,
    ) -> None:
        try:
            from paddleocr import PaddleOCR
        except Exception as error:
            raise OcrError(
                "PaddleOCR is not installed. Install PaddlePaddle CPU and paddleocr first."
            ) from error

        options: dict[str, Any] = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            "engine": "paddle",
            "lang": language,
            "device": device,
            "enable_mkldnn": False,
            "cpu_threads": cpu_threads,
        }
        started = time.perf_counter()
        try:
            try:
                self._ocr = PaddleOCR(**options)
            except TypeError:
                options.pop("device", None)
                try:
                    self._ocr = PaddleOCR(**options)
                except TypeError:
                    options.pop("engine", None)
                    self._ocr = PaddleOCR(**options)
        except Exception as error:
            raise OcrError(f"PaddleOCR initialization failed: {error}") from error

        self._initialization_seconds = time.perf_counter() - started
        self._last_inference_seconds = 0.0
        self._total_inference_seconds = 0.0
        self._inference_calls = 0
        self._inference_durations_seconds: list[float] = []
        self._last_result_structure: dict[str, Any] | None = None
        self._language = language
        self._device = device
        self._cpu_threads = cpu_threads
        self._write_stage_marker()

    def _write_stage_marker(self) -> None:
        configured = os.environ.get("COURSE_WIDGET_OCR_STAGE_FILE", "").strip()
        if not configured:
            return
        path = Path(configured)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(
                json.dumps(
                    {
                        "stage": "model-ready",
                        "initializationSeconds": self._initialization_seconds,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            temporary.replace(path)
        except OSError:
            # Progress reporting must never turn a successful OCR initialization into a failure.
            pass

    def version_info(self) -> dict[str, str]:
        values = super().version_info()
        values["cpuBackend"] = "paddle-no-mkldnn"
        values["enableMkldnn"] = "false"
        values["cpuThreads"] = str(self._cpu_threads)
        return values
