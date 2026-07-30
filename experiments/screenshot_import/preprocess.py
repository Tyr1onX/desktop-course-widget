from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from .models import PreprocessedImage


class ImageReadError(RuntimeError):
    pass


@dataclass(frozen=True)
class PreprocessConfig:
    scale: float = 1.0
    max_dimension: int | None = 2200
    deskew: bool = True
    max_skew_degrees: float = 5.0
    adaptive_block_size: int = 31
    adaptive_c: int = 11


def _load_exif_corrected(path: Path) -> np.ndarray:
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise ImageReadError("only PNG, JPG, and JPEG are supported")
    try:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            rgb = np.asarray(image)
    except Exception as error:  # Pillow raises format-specific exceptions.
        raise ImageReadError(f"could not read image: {error}") from error
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _estimate_skew(gray: np.ndarray, max_degrees: float) -> tuple[float, list[str]]:
    warnings: list[str] = []
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    minimum_length = max(60, min(gray.shape[:2]) // 5)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 1800.0,
        threshold=max(50, minimum_length // 2),
        minLineLength=minimum_length,
        maxLineGap=max(8, minimum_length // 12),
    )
    if lines is None:
        return 0.0, ["未找到足够长的直线，跳过倾斜校正"]

    angles: list[float] = []
    for line in lines[:, 0, :]:
        x1, y1, x2, y2 = map(float, line)
        angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        normalized = ((angle + 90.0) % 180.0) - 90.0
        if abs(normalized) <= max_degrees:
            angles.append(normalized)
        elif abs(abs(normalized) - 90.0) <= max_degrees:
            vertical_offset = normalized - np.sign(normalized) * 90.0
            angles.append(float(vertical_offset))

    if len(angles) < 3:
        warnings.append("直线角度样本不足，跳过倾斜校正")
        return 0.0, warnings

    median = float(np.median(np.asarray(angles, dtype=np.float64)))
    if abs(median) < 0.05:
        return 0.0, warnings
    if abs(median) > max_degrees:
        warnings.append(f"估算倾斜角 {median:.2f}° 超出实验范围，跳过校正")
        return 0.0, warnings
    return median, warnings


def preprocess_image(path: str | Path, config: PreprocessConfig | None = None) -> PreprocessedImage:
    config = config or PreprocessConfig()
    source_path = Path(path)
    original = _load_exif_corrected(source_path)
    original_height, original_width = original.shape[:2]

    requested_scale = float(config.scale)
    if requested_scale <= 0:
        raise ValueError("scale must be greater than zero")
    if config.max_dimension:
        requested_scale = min(
            requested_scale,
            config.max_dimension / max(original_width, original_height),
        )
    requested_scale = max(requested_scale, 0.1)

    scaled_width = max(1, int(round(original_width * requested_scale)))
    scaled_height = max(1, int(round(original_height * requested_scale)))
    interpolation = cv2.INTER_AREA if requested_scale < 1.0 else cv2.INTER_CUBIC
    scaled = cv2.resize(original, (scaled_width, scaled_height), interpolation=interpolation)
    gray_scaled = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray_scaled)

    angle = 0.0
    warnings: list[str] = []
    if config.deskew:
        angle, angle_warnings = _estimate_skew(enhanced, config.max_skew_degrees)
        warnings.extend(angle_warnings)

    center = (scaled_width / 2.0, scaled_height / 2.0)
    rotation_2x3 = cv2.getRotationMatrix2D(center, angle, 1.0)
    working = cv2.warpAffine(
        scaled,
        rotation_2x3,
        (scaled_width, scaled_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )
    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    gray = clahe.apply(gray)

    block_size = max(3, config.adaptive_block_size | 1)
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        block_size,
        config.adaptive_c,
    )

    scale_matrix = np.array(
        [[requested_scale, 0.0, 0.0], [0.0, requested_scale, 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    rotation_matrix = np.vstack([rotation_2x3, [0.0, 0.0, 1.0]]).astype(np.float64)
    transform = rotation_matrix @ scale_matrix
    inverse = np.linalg.inv(transform)

    return PreprocessedImage(
        original_bgr=original,
        working_bgr=working,
        gray=gray,
        binary=binary,
        transform=transform,
        inverse_transform=inverse,
        original_width=original_width,
        original_height=original_height,
        applied_scale=requested_scale,
        deskew_angle=angle,
        warnings=warnings,
    )
