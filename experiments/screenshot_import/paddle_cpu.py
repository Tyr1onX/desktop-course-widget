from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .ocr import OcrError, PaddleOcrEngine

MOBILE_DETECTION_MODEL = "PP-OCRv5_mobile_det"
MOBILE_RECOGNITION_MODEL = "PP-OCRv5_mobile_rec"
DEFAULT_DETECTION_LIMIT = 1600


def _default_cpu_threads() -> int:
    configured = os.environ.get("COURSE_WIDGET_OCR_CPU_THREADS", "").strip()
    if configured:
        try:
            return max(1, min(8, int(configured)))
        except ValueError:
            pass
    logical = os.cpu_count() or 4
    if logical <= 2:
        return logical
    return max(2, min(8, logical // 2))


class WindowsCpuPaddleOcrEngine(PaddleOcrEngine):
    """PaddleOCR adapter tuned for an offline Windows desktop application."""

    def __init__(
        self,
        *,
        language: str = "ch",
        device: str = "cpu",
        cpu_threads: int | None = None,
    ) -> None:
        try:
            from paddleocr import PaddleOCR
        except Exception as error:
            raise OcrError(
                "PaddleOCR is not installed. Install PaddlePaddle CPU and paddleocr first."
            ) from error

        resolved_threads = cpu_threads or _default_cpu_threads()
        options: dict[str, Any] = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            "text_detection_model_name": MOBILE_DETECTION_MODEL,
            "text_recognition_model_name": MOBILE_RECOGNITION_MODEL,
            "text_recognition_batch_size": 8,
            "text_det_limit_side_len": DEFAULT_DETECTION_LIMIT,
            "text_det_limit_type": "max",
            "engine": "paddle",
            "lang": language,
            "device": device,
            "enable_mkldnn": False,
            "cpu_threads": resolved_threads,
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
        self._cpu_threads = resolved_threads
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
                        "cpuThreads": self._cpu_threads,
                        "detectionModel": MOBILE_DETECTION_MODEL,
                        "recognitionModel": MOBILE_RECOGNITION_MODEL,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            temporary.replace(path)
        except OSError:
            # Progress reporting must never turn successful initialization into failure.
            pass

    def version_info(self) -> dict[str, str]:
        values = super().version_info()
        values["cpuBackend"] = "paddle-no-mkldnn"
        values["enableMkldnn"] = "false"
        values["cpuThreads"] = str(self._cpu_threads)
        values["detectionModel"] = MOBILE_DETECTION_MODEL
        values["recognitionModel"] = MOBILE_RECOGNITION_MODEL
        values["detectionLimit"] = str(DEFAULT_DETECTION_LIMIT)
        return values
