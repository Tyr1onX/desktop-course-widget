from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image

import experiments.screenshot_import.corpus as corpus_module
from experiments.screenshot_import.corpus import (
    build_corpus_variants,
    fetch_public_corpus,
    load_corpus_manifest,
    select_samples,
)


def _manifest_payload() -> dict:
    return {
        "schemaVersion": 1,
        "samples": [
            {
                "id": "sample-one",
                "title": "Sample one",
                "filename": "sample-one.png",
                "sourcePage": "https://commons.wikimedia.org/wiki/File:Sample.png",
                "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/0/00/Sample.png",
                "sha256": "0" * 64,
                "license": "CC0-1.0",
                "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
                "author": "Example",
                "attribution": "Example sample, CC0 1.0.",
                "role": "positive-layout",
                "expectedBehavior": "Recognize or return review.",
                "tags": ["weekly-grid"],
            }
        ],
    }


def _write_manifest(path: Path, payload: dict | None = None) -> Path:
    path.write_text(
        json.dumps(payload or _manifest_payload(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def test_committed_public_corpus_manifest_is_valid() -> None:
    manifest = load_corpus_manifest()
    assert len(manifest.samples) >= 6
    assert {sample.role for sample in manifest.samples} >= {
        "positive-layout",
        "negative-layout",
        "layout-only",
    }
    assert all(sample.download_url.startswith("https://") for sample in manifest.samples)
    assert all(len(sample.sha256) == 64 for sample in manifest.samples)
    assert len({sample.sha256 for sample in manifest.samples}) == len(manifest.samples)


def test_manifest_rejects_duplicate_ids(tmp_path: Path) -> None:
    payload = _manifest_payload()
    payload["samples"].append(dict(payload["samples"][0]))
    path = _write_manifest(tmp_path / "manifest.json", payload)
    with pytest.raises(ValueError, match="duplicate corpus sample id"):
        load_corpus_manifest(path)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("filename", "../escape.png", "unsafe corpus filename"),
        ("downloadUrl", "http://example.com/sample.png", "must use https"),
        ("downloadUrl", "https://example.com/sample.png", "host is not allowed"),
        ("sha256", "not-a-hash", "sha256 must be 64 lowercase hex"),
        ("license", "All-Rights-Reserved", "unsupported corpus license"),
        ("role", "accuracy-positive", "unsupported corpus role"),
    ],
)
def test_manifest_rejects_unsafe_or_unlicensed_sources(
    tmp_path: Path,
    field: str,
    value: str,
    message: str,
) -> None:
    payload = _manifest_payload()
    payload["samples"][0][field] = value
    path = _write_manifest(tmp_path / "manifest.json", payload)
    with pytest.raises(ValueError, match=message):
        load_corpus_manifest(path)


def test_sample_selection_preserves_requested_order(tmp_path: Path) -> None:
    payload = _manifest_payload()
    second = dict(payload["samples"][0])
    second["id"] = "sample-two"
    second["filename"] = "sample-two.png"
    second["sha256"] = "1" * 64
    payload["samples"].append(second)
    manifest = load_corpus_manifest(_write_manifest(tmp_path / "manifest.json", payload))
    selected = select_samples(manifest, ["sample-two", "sample-one"])
    assert [sample.sample_id for sample in selected] == ["sample-two", "sample-one"]


def test_fetch_rejects_and_removes_unexpected_content(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = _write_manifest(tmp_path / "manifest.json")

    def fake_download(_url: str, destination: Path) -> None:
        Image.new("RGB", (640, 480), "white").save(destination)

    monkeypatch.setattr(corpus_module, "_download_image", fake_download)
    with pytest.raises(ValueError, match="corpus image hash mismatch"):
        fetch_public_corpus(
            tmp_path / "corpus",
            manifest_path=manifest_path,
        )
    assert not (tmp_path / "corpus" / "raw" / "sample-one.png").exists()


def test_builds_deterministic_robustness_variants(tmp_path: Path) -> None:
    raw_dir = tmp_path / "corpus" / "raw"
    raw_dir.mkdir(parents=True)
    source = raw_dir / "sample-one.png"
    Image.new("RGB", (640, 480), "white").save(source)

    payload = _manifest_payload()
    payload["samples"][0]["sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest_path = _write_manifest(tmp_path / "manifest.json", payload)

    first = build_corpus_variants(
        tmp_path / "corpus",
        manifest_path=manifest_path,
    )
    first_payload = json.loads(
        (tmp_path / "corpus" / "variants.json").read_text(encoding="utf-8")
    )
    first_hashes = [item["sha256"] for item in first_payload["variants"]]

    second = build_corpus_variants(
        tmp_path / "corpus",
        manifest_path=manifest_path,
    )
    second_payload = json.loads(
        (tmp_path / "corpus" / "variants.json").read_text(encoding="utf-8")
    )
    second_hashes = [item["sha256"] for item in second_payload["variants"]]

    assert first["variants"] == 6
    assert second["variants"] == 6
    assert first_hashes == second_hashes
    assert {item["expected"] for item in second_payload["variants"]} == {
        "review-or-recognize",
        "detect-incomplete-or-review",
    }
    assert any(
        item["variant"] == "cropped-bottom-8pct"
        for item in second_payload["variants"]
    )
