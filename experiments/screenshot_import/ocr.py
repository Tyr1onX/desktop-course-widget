from __future__ import annotations

import json
from abc import ABC, abstractmethod
from importlib import metadata
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .models import OcrToken, PixelBox


class OcrError(RuntimeError):
    pass


class OcrEngine(ABC):
    @abstractmethod
    def recognize(self, image_bgr: np.ndarray, region: PixelBox) -> list[OcrToken]:
        """Recognize text inside region and return tokens in original-image coordinates."""

    @abstractmethod
    def version_info(self) -> dict[str, str]:
        pass


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
        result: list[OcrToken] = []
        for token in self._tokens:
            cx, cy = token.box.center
            if x1 - 4 <= cx <= x2 + 4 and y1 - 4 <= cy <= y2 + 4:
                result.append(token)
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
        try:
            self._ocr = PaddleOCR(**options)
        except TypeError:
            # Compatible 3.x builds differ slightly in optional runtime knobs.
            options.pop("device", None)
            try:
                self._ocr = PaddleOCR(**options)
            except TypeError:
                options.pop("engine", None)
                self._ocr = PaddleOCR(**options)
        self._language = language
        self._device = device

    @staticmethod
    def _payload(result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            return result.get("res", result)
        json_value = getattr(result, "json", None)
        if callable(json_value):
            json_value = json_value()
        if isinstance(json_value, str):
            json_value = json.loads(json_value)
        if isinstance(json_value, dict):
            return json_value.get("res", json_value)
        to_dict = getattr(result, "to_dict", None)
        if callable(to_dict):
            value = to_dict()
            if isinstance(value, dict):
                return value.get("res", value)
        raise OcrError(f"Unsupported PaddleOCR result type: {type(result)!r}")

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
        try:
            results = self._ocr.predict(crop)
        except Exception as error:
            raise OcrError(f"PaddleOCR inference failed: {error}") from error

        tokens: list[OcrToken] = []
        for result in results:
            payload = self._payload(result)
            texts = list(payload.get("rec_texts") or [])
            scores = list(payload.get("rec_scores") or [])
            boxes = payload.get("rec_boxes")
            if boxes is None:
                boxes = payload.get("rec_polys")
            if boxes is None:
                boxes = payload.get("dt_polys")
            boxes = list(boxes or [])
            for index, text in enumerate(texts):
                text = str(text).strip()
                if not text:
                    continue
                confidence = float(scores[index]) if index < len(scores) else 0.0
                raw_box = np.asarray(boxes[index]) if index < len(boxes) else None
                if raw_box is None or raw_box.size < 4:
                    token_box = PixelBox(float(x1), float(y1), float(x2 - x1), float(y2 - y1))
                else:
                    if raw_box.ndim == 1 and raw_box.size >= 4:
                        bx1, by1, bx2, by2 = map(float, raw_box[:4])
                    else:
                        points = raw_box.reshape(-1, 2).astype(np.float64)
                        bx1, by1 = points.min(axis=0)
                        bx2, by2 = points.max(axis=0)
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
        for package, key in [
            ("paddleocr", "paddleocr"),
            ("paddlepaddle", "paddlepaddle"),
        ]:
            try:
                values[key] = metadata.version(package)
            except metadata.PackageNotFoundError:
                values[key] = "unknown"
        return values
