from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from PIL import Image, ImageEnhance, ImageFilter

SCHEMA_VERSION = 1
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
DOWNLOAD_ATTEMPTS = 4
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}
CORPUS_USER_AGENT = (
    "desktop-course-widget/0.4.0 "
    "(https://github.com/Tyr1onX/desktop-course-widget; timetable corpus benchmark)"
)
ALLOWED_LICENSES = {
    "CC0-1.0",
    "CC-BY-SA-3.0",
    "CC-BY-SA-4.0",
    "Public-Domain",
}
ALLOWED_DOWNLOAD_HOSTS = {
    "commons.wikimedia.org",
    "upload.wikimedia.org",
}
SAMPLE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ROLES = {"positive-layout", "negative-layout", "layout-only"}


@dataclass(frozen=True)
class CorpusSample:
    sample_id: str
    title: str
    filename: str
    source_page: str
    download_url: str
    sha256: str
    license_id: str
    license_url: str
    author: str
    attribution: str
    role: str
    expected_behavior: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class CorpusManifest:
    schema_version: int
    samples: tuple[CorpusSample, ...]


def default_manifest_path() -> Path:
    return Path(__file__).resolve().parent / "corpus" / "public_samples.json"


def load_corpus_manifest(path: str | Path | None = None) -> CorpusManifest:
    manifest_path = Path(path) if path else default_manifest_path()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"corpus manifest schemaVersion must be {SCHEMA_VERSION}")
    raw_samples = payload.get("samples")
    if not isinstance(raw_samples, list) or not raw_samples:
        raise ValueError("corpus manifest must contain a non-empty samples list")

    samples: list[CorpusSample] = []
    seen_ids: set[str] = set()
    seen_filenames: set[str] = set()
    for index, raw in enumerate(raw_samples):
        if not isinstance(raw, dict):
            raise ValueError(f"sample {index + 1} must be an object")
        sample = _parse_sample(raw, index)
        if sample.sample_id in seen_ids:
            raise ValueError(f"duplicate corpus sample id: {sample.sample_id}")
        if sample.filename.casefold() in seen_filenames:
            raise ValueError(f"duplicate corpus filename: {sample.filename}")
        seen_ids.add(sample.sample_id)
        seen_filenames.add(sample.filename.casefold())
        samples.append(sample)
    return CorpusManifest(schema_version=SCHEMA_VERSION, samples=tuple(samples))


def _parse_sample(raw: dict[str, Any], index: int) -> CorpusSample:
    def required_string(key: str) -> str:
        value = raw.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"sample {index + 1} field {key} must be a non-empty string")
        return value.strip()

    sample_id = required_string("id")
    if not SAMPLE_ID_PATTERN.fullmatch(sample_id):
        raise ValueError(f"invalid corpus sample id: {sample_id}")

    filename = required_string("filename")
    if Path(filename).name != filename or filename.startswith("."):
        raise ValueError(f"unsafe corpus filename: {filename}")
    if Path(filename).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError(f"unsupported corpus image extension: {filename}")

    source_page = required_string("sourcePage")
    download_url = required_string("downloadUrl")
    license_url = required_string("licenseUrl")
    _validate_https_url(source_page, allowed_hosts={"commons.wikimedia.org"})
    _validate_https_url(download_url, allowed_hosts=ALLOWED_DOWNLOAD_HOSTS)
    _validate_https_url(license_url)

    sha256 = required_string("sha256").lower()
    if not SHA256_PATTERN.fullmatch(sha256):
        raise ValueError(f"sample {sample_id} sha256 must be 64 lowercase hex characters")

    license_id = required_string("license")
    if license_id not in ALLOWED_LICENSES:
        raise ValueError(f"unsupported corpus license: {license_id}")

    role = required_string("role")
    if role not in ROLES:
        raise ValueError(f"unsupported corpus role: {role}")

    tags = raw.get("tags")
    if (
        not isinstance(tags, list)
        or not tags
        or any(not isinstance(tag, str) or not tag.strip() for tag in tags)
    ):
        raise ValueError(f"sample {sample_id} tags must be a non-empty string list")

    return CorpusSample(
        sample_id=sample_id,
        title=required_string("title"),
        filename=filename,
        source_page=source_page,
        download_url=download_url,
        sha256=sha256,
        license_id=license_id,
        license_url=license_url,
        author=required_string("author"),
        attribution=required_string("attribution"),
        role=role,
        expected_behavior=required_string("expectedBehavior"),
        tags=tuple(tag.strip() for tag in tags),
    )


def _validate_https_url(value: str, allowed_hosts: set[str] | None = None) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError(f"corpus URL must use https: {value}")
    hostname = parsed.hostname.lower()
    if allowed_hosts and hostname not in allowed_hosts:
        raise ValueError(f"corpus URL host is not allowed: {hostname}")


def select_samples(
    manifest: CorpusManifest,
    sample_ids: Iterable[str] | None = None,
) -> tuple[CorpusSample, ...]:
    requested = tuple(sample_ids or ())
    if not requested:
        return manifest.samples
    by_id = {sample.sample_id: sample for sample in manifest.samples}
    missing = [sample_id for sample_id in requested if sample_id not in by_id]
    if missing:
        raise ValueError(f"unknown corpus sample ids: {', '.join(missing)}")
    return tuple(by_id[sample_id] for sample_id in requested)


def fetch_public_corpus(
    output_dir: str | Path,
    *,
    manifest_path: str | Path | None = None,
    sample_ids: Iterable[str] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    manifest = load_corpus_manifest(manifest_path)
    selected = select_samples(manifest, sample_ids)
    root = Path(output_dir)
    raw_dir = root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    for sample in selected:
        destination = raw_dir / sample.filename
        if force or not destination.is_file():
            _download_image(sample.download_url, destination)
        width, height = _verify_image(destination)
        actual_sha256 = _sha256(destination)
        if actual_sha256 != sample.sha256:
            destination.unlink(missing_ok=True)
            raise ValueError(
                f"corpus image hash mismatch for {sample.sample_id}: "
                f"expected {sample.sha256}, got {actual_sha256}"
            )
        records.append(
            {
                "id": sample.sample_id,
                "filename": sample.filename,
                "sha256": actual_sha256,
                "bytes": destination.stat().st_size,
                "width": width,
                "height": height,
                "license": sample.license_id,
                "sourcePage": sample.source_page,
            }
        )

    lock = {"schemaVersion": SCHEMA_VERSION, "samples": records}
    (root / "corpus-lock.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _write_attribution(root / "ATTRIBUTION.md", selected)
    return {
        "output": str(root),
        "downloaded": len(records),
        "lock": str(root / "corpus-lock.json"),
        "attribution": str(root / "ATTRIBUTION.md"),
        "samples": records,
    }


def _download_image(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    last_error: urllib.error.HTTPError | None = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": CORPUS_USER_AGENT,
                "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1",
                "Referer": "https://commons.wikimedia.org/",
            },
        )
        temp_path: Path | None = None
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                final_url = response.geturl()
                _validate_https_url(final_url, allowed_hosts=ALLOWED_DOWNLOAD_HOSTS)
                declared_length = response.headers.get("Content-Length")
                if declared_length and int(declared_length) > MAX_DOWNLOAD_BYTES:
                    raise ValueError(f"corpus image exceeds {MAX_DOWNLOAD_BYTES} bytes")
                content_type = response.headers.get_content_type()
                if not content_type.startswith("image/"):
                    raise ValueError(f"corpus URL did not return an image: {content_type}")
                with tempfile.NamedTemporaryFile(
                    prefix=f".{destination.name}.",
                    suffix=".tmp",
                    dir=destination.parent,
                    delete=False,
                ) as temporary:
                    temp_path = Path(temporary.name)
                    total = 0
                    while chunk := response.read(64 * 1024):
                        total += len(chunk)
                        if total > MAX_DOWNLOAD_BYTES:
                            raise ValueError(
                                f"corpus image exceeds {MAX_DOWNLOAD_BYTES} bytes"
                            )
                        temporary.write(chunk)
            _verify_image(temp_path)
            os.replace(temp_path, destination)
            temp_path = None
            return
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_HTTP_STATUS or attempt == DOWNLOAD_ATTEMPTS:
                raise
            retry_after = error.headers.get("Retry-After") if error.headers else None
            delay = _retry_delay_seconds(attempt, retry_after)
            time.sleep(delay)
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"failed to download corpus image: {url}")


def _retry_delay_seconds(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        try:
            return min(30.0, max(1.0, float(retry_after)))
        except ValueError:
            pass
    return min(20.0, 2.0 ** attempt)


def _verify_image(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            width, height = image.size
    except Exception as error:
        raise ValueError(f"invalid corpus image {path.name}: {error}") from error
    if width < 120 or height < 120:
        raise ValueError(f"corpus image is too small: {path.name} ({width}x{height})")
    return width, height


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(128 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_attribution(path: Path, samples: Iterable[CorpusSample]) -> None:
    lines = [
        "# Public timetable corpus attribution",
        "",
        "Downloaded images are not part of the repository. Keep this file beside local corpus copies.",
        "",
    ]
    for sample in samples:
        lines.extend(
            [
                f"## {sample.title}",
                "",
                f"- ID: `{sample.sample_id}`",
                f"- Author: {sample.author}",
                f"- License: [{sample.license_id}]({sample.license_url})",
                f"- Source: {sample.source_page}",
                f"- SHA-256: `{sample.sha256}`",
                f"- Attribution: {sample.attribution}",
                "",
            ]
        )
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def build_corpus_variants(
    corpus_dir: str | Path,
    *,
    manifest_path: str | Path | None = None,
    sample_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    manifest = load_corpus_manifest(manifest_path)
    selected = select_samples(manifest, sample_ids)
    root = Path(corpus_dir)
    raw_dir = root / "raw"
    variant_dir = root / "variants"
    if variant_dir.exists():
        shutil.rmtree(variant_dir)
    variant_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    for sample in selected:
        source = raw_dir / sample.filename
        if not source.is_file():
            raise FileNotFoundError(
                f"missing corpus image {source}; run fetch-corpus first"
            )
        actual_sha256 = _sha256(source)
        if actual_sha256 != sample.sha256:
            raise ValueError(
                f"corpus image hash mismatch for {sample.sample_id}: "
                f"expected {sample.sha256}, got {actual_sha256}"
            )
        with Image.open(source) as opened:
            image = opened.convert("RGB")
        sample_dir = variant_dir / sample.sample_id
        sample_dir.mkdir(parents=True, exist_ok=True)
        for name, variant, expected in _variants(image):
            output = sample_dir / f"{name}.jpg"
            variant.save(output, "JPEG", quality=88, subsampling=0)
            width, height = variant.size
            records.append(
                {
                    "sourceId": sample.sample_id,
                    "variant": name,
                    "filename": str(output.relative_to(root)).replace("\\", "/"),
                    "width": width,
                    "height": height,
                    "sha256": _sha256(output),
                    "expected": expected,
                }
            )

    payload = {"schemaVersion": SCHEMA_VERSION, "variants": records}
    index_path = root / "variants.json"
    index_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "output": str(variant_dir),
        "variants": len(records),
        "index": str(index_path),
        "samples": len(selected),
    }


def _variants(image: Image.Image) -> tuple[tuple[str, Image.Image, str], ...]:
    width, height = image.size
    downscaled = image.resize(
        (max(120, round(width * 0.70)), max(120, round(height * 0.70))),
        Image.Resampling.LANCZOS,
    )
    compressed = _jpeg_round_trip(image, quality=52)
    low_contrast = ImageEnhance.Contrast(image).enhance(0.52)
    blurred = image.filter(ImageFilter.GaussianBlur(radius=1.2))
    rotated = image.rotate(
        1.6,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(246, 246, 246),
    )
    crop_height = max(120, round(height * 0.92))
    incomplete = image.crop((0, 0, width, crop_height))
    return (
        ("downscaled-70", downscaled, "review-or-recognize"),
        ("jpeg-q52", compressed, "review-or-recognize"),
        ("low-contrast", low_contrast, "review-or-recognize"),
        ("blur-1p2", blurred, "review-or-recognize"),
        ("rotated-1p6", rotated, "review-or-recognize"),
        ("cropped-bottom-8pct", incomplete, "detect-incomplete-or-review"),
    )


def _jpeg_round_trip(image: Image.Image, *, quality: int) -> Image.Image:
    with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as buffer:
        image.save(buffer, "JPEG", quality=quality, subsampling=2)
        buffer.seek(0)
        with Image.open(buffer) as decoded:
            return decoded.convert("RGB")
