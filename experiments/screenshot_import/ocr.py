from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from collections.abc import Iterable
from importlib import metadata
from pathlib import Path
from typing import Any

import numpy as np

from .models import OcrToken, PixelBox


class OcrError(RuntimeError):
    pass


def _as_sequence(value: Any) -> list[Any]:
    """Convert Paddle values without relying on NumPy truth-value semantics."""
    if value is None:
        return []
    if isinstance(value, np.ndarray):
        if value.ndim == 0:
            return [value.item()]
        return list(value)
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, (str, bytes, bytearray)):
        return [value]
    if isinstance(value, dict):
        return [value]
    if isinstance(value, Iterable):
        return list(value)
    return [value]


def _result_items(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, dict) or hasattr(value, "json") or hasattr(value, "to_dict"):
        return [value]
    if isinstance(value, np.ndarray):
        raise OcrError(f"Unsupported PaddleOCR prediction container: {type(value)!r}")
    if isinstance(value, (str, bytes, bytearray)):
        raise OcrError(f"Unsupported PaddleOCR prediction container: {type(value)!r}")
    try:
        return list(value)
    except TypeError:
        return [value]


class OcrEngine(ABC):
    @abstractmethod
    def recognize(self, image_bgr: np.ndarray, region: PixelBox) -> list[OcrToken]:
        """Recognize text inside region and return tokens in original-image coordinates."""

    @abstractmethod
    def version_info(self) -> dict[str, str]:
        pass

    def runtime_info(self) -> dict[str, float]:
        return {}


class FixtureOcrEngine(OcrEngine):
    def __init__(self, fixture_path: str | Path):
        payload = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
        self._tokens = [
            OcrToken(
                text=str(token["text"]),
                confidence=float(token.get("confidence", 0.99)),
                box=PixelBox(**token["box"]),
            )
            for token in payload.get("tokens", [])
        ]
        self._name = str(payload.get("name", "fixture"))

    def recognize(self, image_bgr: np.ndarray, region: PixelBox) -> list[OcrToken]:
        del image_bgr
        x1, y1, x2, y2 = region.x, region.y, region.right, region.bottom
        result = [
            token for token in self._tokens
            if x1 - 4 <= token.box.center[0] <= x2 + 4
            and y1 - 4 <= token.box.center[1] <= y2 + 4
        ]
        return sorted(result, key=lambda token: (token.box.y, token.box.x))

    def version_info(self) -> dict[str, str]:
        return {"engine": "fixture", "fixture": self._name}


class PaddleOcrEngine(OcrEngine):
    def __init__(self, *, language: str = "ch", device: str = "cpu"):
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
        self._language = language
        self._device = device

    @staticmethod
    def _payload(result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            value = result
        else:
            json_value = getattr(result, "json", None)
            if callable(json_value):
                try:
                    json_value = json_value()
                except Exception as error:
                    raise OcrError(f"PaddleOCR result.json() failed: {error}") from error
            if isinstance(json_value, str):
                try:
                    json_value = json.loads(json_value)
                except json.JSONDecodeError as error:
                    raise OcrError("PaddleOCR result.json contained invalid JSON") from error
            if isinstance(json_value, dict):
                value = json_value
            else:
                to_dict = getattr(result, "to_dict", None)
                if callable(to_dict):
                    try:
                        value = to_dict()
                    except Exception as error:
                        raise OcrError(f"PaddleOCR result.to_dict() failed: {error}") from error
                    if not isinstance(value, dict):
                        raise OcrError(
                            f"Unsupported PaddleOCR to_dict result: {type(value)!r}"
                        )
                else:
                    raise OcrError(f"Unsupported PaddleOCR result type: {type(result)!r}")
        nested = value.get("res")
        return nested if isinstance(nested, dict) else value

    @staticmethod
    def _boxes(payload: dict[str, Any]) -> list[Any]:
        for key in ("rec_boxes", "rec_polys", "dt_polys"):
            values = _as_sequence(payload.get(key))
            if values:
                return values
        return []

    def recognize(self, image_bgr: np.ndarray, region: PixelBox) -> list[OcrToken]:
        image_height, image_width = image_bgr.shape[:2]
        clipped = region.clipped(image_width, image_height)
        x1 = max(0, int(np.floor(clipped.x)))
        y1 = max(0, int(np.floor(clipped.y)))
        x2 = min(image_width, int(np.ceil(clipped.right)))
        y2 = min(image_height, int(np.ceil(clipped.bottom)))
        if x2 <= x1 or y2 <= y1:
            return []
        crop = image_bgr[y1:y2, x1:x2]
        started = time.perf_counter()
        try:
            prediction = self._ocr.predict(crop)
        except Exception as error:
            raise OcrError(f"PaddleOCR inference failed: {error}") from error
        elapsed = time.perf_counter() - started
        self._last_inference_seconds = elapsed
        self._total_inference_seconds += elapsed
        self._inference_calls += 1

        tokens: list[OcrToken] = []
        for result in _result_items(prediction):
            payload = self._payload(result)
            texts = _as_sequence(payload.get("rec_texts"))
            scores = _as_sequence(payload.get("rec_scores"))
            boxes = self._boxes(payload)
            for index, raw_text in enumerate(texts):
                text = str(raw_text).strip()
                if not text:
                    continue
                try:
                    confidence = float(scores[index]) if index < len(scores) else 0.0
                except (TypeError, ValueError):
                    confidence = 0.0
                raw_box = np.asarray(boxes[index]) if index < len(boxes) else None
                if raw_box is None or raw_box.size < 4:
                    token_box = PixelBox(float(x1), float(y1), float(x2 - x1), float(y2 - y1))
                else:
                    try:
                        if raw_box.ndim == 1 and raw_box.size >= 4:
                            bx1, by1, bx2, by2 = map(float, raw_box[:4])
                        else:
                            points = raw_box.reshape(-1, 2).astype(np.float64)
                            bx1, by1 = points.min(axis=0)
                            bx2, by2 = points.max(axis=0)
                    except (TypeError, ValueError) as error:
                        raise OcrError(f"Invalid PaddleOCR coordinate box at index {index}") from error
                    token_box = PixelBox(
                        x=float(x1 + bx1),
                        y=float(y1 + by1),
                        width=max(1.0, float(bx2 - bx1)),
                        height=max(1.0, float(by2 - by1)),
                    ).clipped(image_width, image_height)
                tokens.append(OcrToken(text=text, confidence=confidence, box=token_box))
        return sorted(tokens, key=lambda token: (token.box.y, token.box.x))

    def version_info(self) -> dict[str, str]:
        values = {
            "engine": "paddleocr-local-cpu",
            "language": self._language,
            "device": self._device,
        }
        for package, key in [("paddleocr", "paddleocr"), ("paddlepaddle", "paddlepaddle")]:
            try:
                values[key] = metadata.version(package)
            except metadata.PackageNotFoundError:
                values[key] = "unknown"
        return values

    def runtime_info(self) -> dict[str, float]:
        return {
            "initializationSeconds": self._initialization_seconds,
            "lastInferenceSeconds": self._last_inference_seconds,
            "totalInferenceSeconds": self._total_inference_seconds,
            "inferenceCalls": float(self._inference_calls),
        }
