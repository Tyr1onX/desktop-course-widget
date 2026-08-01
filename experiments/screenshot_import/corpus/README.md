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
