# Public timetable corpus

This directory defines a small, reproducible corpus for screenshot-import robustness work.

The repository stores only:

- source pages and stable download URLs;
- author and license metadata;
- expected high-level behavior;
- code that downloads and transforms the images locally.

The third-party image files themselves are **not committed**. This keeps repository size small, preserves attribution beside each local copy, and avoids treating arbitrary timetable screenshots found online as reusable test data.

## Fetch the public corpus

```powershell
python -m experiments.screenshot_import fetch-corpus `
  --output .tmp/screenshot-import-corpus
```

The command writes:

- `raw/` — downloaded originals;
- `corpus-lock.json` — resolved dimensions, byte sizes, and SHA-256 hashes;
- `ATTRIBUTION.md` — attribution and license details for every local image.

To fetch only selected samples:

```powershell
python -m experiments.screenshot_import fetch-corpus `
  --output .tmp/screenshot-import-corpus `
  --id commons-stundenplan `
  --id commons-lukujarjestys-photo
```

## Build robustness variants

```powershell
python -m experiments.screenshot_import build-corpus-variants `
  --corpus .tmp/screenshot-import-corpus
```

Each source image receives deterministic variants for:

- downscaling;
- JPEG compression;
- low contrast;
- slight blur;
- slight rotation;
- an intentionally cropped bottom edge.

The cropped variant is not expected to be recognized successfully. It exists to verify that the product detects an incomplete screenshot or leaves the result clearly reviewable instead of silently creating a wrong timetable.

## Run the OCR-first corpus benchmark

The benchmark command uses the same PaddleOCR-first pipeline as the product-facing screenshot import:

```powershell
python -m experiments.screenshot_import benchmark-corpus `
  --corpus .tmp/screenshot-import-corpus `
  --output .tmp/screenshot-import-corpus-report `
  --repo-root .
```

It writes:

- `corpus-benchmark.json` — machine-readable policy, per-case result, timing, warning, and failure classification;
- `corpus-benchmark.md` — a compact review table;
- `cases/` — the normal per-image OCR debug outputs.

The default gate is intentionally conservative during the first baseline:

- a pipeline crash is a failure;
- recognizing a declared negative sample as a weekly timetable is a failure;
- positive-layout misses are measured but do not yet block;
- cropped images that are accepted without any warning are measured but do not yet block.

After a baseline is recorded, stricter policies can be enabled explicitly:

```powershell
python -m experiments.screenshot_import benchmark-corpus `
  --corpus .tmp/screenshot-import-corpus `
  --output .tmp/screenshot-import-corpus-report `
  --repo-root . `
  --require-positive `
  --strict-incomplete
```

Useful development filters include:

```powershell
# Fast smoke test
python -m experiments.screenshot_import benchmark-corpus `
  --corpus .tmp/screenshot-import-corpus `
  --output .tmp/screenshot-import-corpus-smoke `
  --max-cases 4

# Only originals
python -m experiments.screenshot_import benchmark-corpus `
  --corpus .tmp/screenshot-import-corpus `
  --output .tmp/screenshot-import-corpus-originals `
  --originals-only

# One sample and all its variants
python -m experiments.screenshot_import benchmark-corpus `
  --corpus .tmp/screenshot-import-corpus `
  --output .tmp/screenshot-import-corpus-photo `
  --id commons-lukujarjestys-photo
```

The normal repository `Validate` workflow remains offline and does not download these images or install PaddleOCR models. It tests the manifest, transformations, case enumeration, failure classification, policy gates, and report generation with deterministic fake recognizer results.

## What these samples can and cannot measure

The public set is useful for:

- weekly-grid and non-weekly-layout discrimination;
- photo, scan, perspective, contrast, compression, and typography robustness;
- crash prevention and clear failure behavior;
- regression testing around incomplete screenshots.

It does **not** provide exact Chinese course-field accuracy by itself. The images use several languages and formats, and most do not have course-level annotations. Exact course name, teacher, location, weekday, section, and week-range scores still require:

1. synthetic Chinese samples with ground truth;
2. explicitly donated or self-created real screenshots;
3. manually reviewed annotations.

## Adding another public sample

A sample may be added only when all of the following are true:

- the image has an explicit reusable license or is in the public domain;
- the source page, author, license, and attribution are recorded;
- the image does not expose a student's name, account, student number, phone number, or other personal data;
- the download uses HTTPS from an allowlisted host;
- the file is useful for a distinct layout or degradation case.

Do not add screenshots copied from search results, social media, school systems, or blogs merely because they are publicly visible.
