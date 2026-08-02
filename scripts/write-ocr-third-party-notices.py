from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path

_REQUIRED_PACKAGES = {
    "numpy",
    "opencv-contrib-python",
    "paddleocr",
    "paddlepaddle",
}
_LICENSE_NAME = re.compile(
    r"^(?:license|licence|copying|notice|copyright)(?:$|[._-].*)",
    re.IGNORECASE,
)


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def safe_located_file(
    distribution: importlib.metadata.Distribution,
    entry: importlib.metadata.PackagePath,
    site_packages: Path,
) -> Path | None:
    try:
        path = Path(distribution.locate_file(entry)).resolve()
        path.relative_to(site_packages)
    except (OSError, ValueError):
        return None
    return path if path.is_file() else None


def license_files(
    distribution: importlib.metadata.Distribution,
    site_packages: Path,
) -> list[Path]:
    found: dict[str, Path] = {}
    for entry in distribution.files or []:
        if not _LICENSE_NAME.match(Path(str(entry)).name):
            continue
        path = safe_located_file(distribution, entry, site_packages)
        if path is not None:
            found[relative_path(site_packages, path)] = path
    return [found[key] for key in sorted(found, key=str.casefold)]


def read_text(path: Path) -> str:
    data = path.read_bytes()
    if b"\x00" in data:
        raise SystemExit(f"license file appears to be binary: {path}")
    return data.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n").rstrip()


def metadata_values(metadata: importlib.metadata.PackageMetadata, key: str) -> list[str]:
    values = metadata.get_all(key) or []
    return sorted({value.strip() for value in values if value and value.strip()}, key=str.casefold)


def package_record(
    distribution: importlib.metadata.Distribution,
    site_packages: Path,
) -> tuple[dict[str, object], list[tuple[str, str]]]:
    metadata = distribution.metadata
    name = metadata.get("Name") or "UNKNOWN"
    version = distribution.version
    files = license_files(distribution, site_packages)
    rendered_files: list[tuple[str, str]] = []
    file_records: list[dict[str, object]] = []
    for path in files:
        text = read_text(path)
        raw = path.read_bytes()
        rel = relative_path(site_packages, path)
        rendered_files.append((rel, text))
        file_records.append(
            {
                "path": rel,
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )

    license_expression = (metadata.get("License-Expression") or "").strip() or None
    license_metadata = (metadata.get("License") or "").strip() or None
    license_classifiers = sorted(
        {
            value.removeprefix("License :: ").strip()
            for value in metadata_values(metadata, "Classifier")
            if value.startswith("License :: ")
        },
        key=str.casefold,
    )
    project_urls: dict[str, str] = {}
    for value in metadata_values(metadata, "Project-URL"):
        label, separator, url = value.partition(",")
        if separator and label.strip() and url.strip():
            project_urls[label.strip()] = url.strip()
    home_page = (metadata.get("Home-page") or "").strip() or None

    record: dict[str, object] = {
        "name": name,
        "normalizedName": normalize(name),
        "version": version,
        "licenseExpression": license_expression,
        "licenseMetadata": license_metadata,
        "licenseClassifiers": license_classifiers,
        "homePage": home_page,
        "projectUrls": dict(sorted(project_urls.items(), key=lambda item: item[0].casefold())),
        "licenseFiles": file_records,
        "hasLicenseEvidence": bool(
            license_expression or license_metadata or license_classifiers or file_records
        ),
    }
    return record, rendered_files


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--component-root", type=Path, required=True)
    parser.add_argument("--site-packages", type=Path, required=True)
    parser.add_argument("--python-root", type=Path, required=True)
    args = parser.parse_args()

    component_root = args.component_root.resolve()
    site_packages = args.site_packages.resolve()
    python_root = args.python_root.resolve()
    distributions = sorted(
        importlib.metadata.distributions(path=[str(site_packages)]),
        key=lambda item: normalize(item.metadata.get("Name") or ""),
    )
    if not distributions:
        raise SystemExit(f"no distributions found in {site_packages}")

    package_records: list[dict[str, object]] = []
    package_notices: list[tuple[dict[str, object], list[tuple[str, str]]]] = []
    seen: set[str] = set()
    for distribution in distributions:
        record, rendered_files = package_record(distribution, site_packages)
        key = str(record["normalizedName"])
        if key in seen:
            raise SystemExit(f"duplicate installed distribution: {record['name']}")
        seen.add(key)
        package_records.append(record)
        package_notices.append((record, rendered_files))

    missing_required = sorted(_REQUIRED_PACKAGES - seen)
    if missing_required:
        raise SystemExit(
            "third-party inventory is missing required OCR packages: "
            + ", ".join(missing_required)
        )

    python_license = python_root / "LICENSE.txt"
    if not python_license.is_file():
        raise SystemExit(f"CPython license file was not found: {python_license}")
    python_license_text = read_text(python_license)
    python_license_bytes = python_license.read_bytes()

    inventory = {
        "schemaVersion": 1,
        "python": {
            "name": "CPython",
            "licenseFile": "python/LICENSE.txt",
            "bytes": len(python_license_bytes),
            "sha256": hashlib.sha256(python_license_bytes).hexdigest(),
        },
        "packageCount": len(package_records),
        "packages": package_records,
    }
    component_root.mkdir(parents=True, exist_ok=True)
    (component_root / "third-party-packages.json").write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    lines = [
        "THIRD-PARTY NOTICES FOR THE COURSE WIDGET OFFLINE OCR COMPONENT",
        "",
        "This file is generated deterministically from the exact distributions bundled in the Windows OCR component.",
        "Package metadata is informational; the packaged license, notice, copying, and copyright files reproduced below remain authoritative.",
        "",
        "=" * 80,
        "CPython",
        "Source: python/LICENSE.txt",
        "=" * 80,
        python_license_text,
        "",
    ]
    for record, rendered_files in package_notices:
        lines.extend(
            [
                "=" * 80,
                f"{record['name']} {record['version']}",
                "=" * 80,
                f"License-Expression: {record['licenseExpression'] or 'not declared'}",
                f"License metadata: {record['licenseMetadata'] or 'not declared'}",
                "License classifiers: "
                + (", ".join(record["licenseClassifiers"]) or "not declared"),
            ]
        )
        if record["homePage"]:
            lines.append(f"Home page: {record['homePage']}")
        for label, url in record["projectUrls"].items():
            lines.append(f"Project URL ({label}): {url}")
        if not rendered_files:
            lines.extend(["Packaged license files: none declared in the wheel", ""])
            continue
        lines.extend(["Packaged license files:", *[f"- {path}" for path, _ in rendered_files], ""])
        for path, text in rendered_files:
            lines.extend([f"--- BEGIN {path} ---", text, f"--- END {path} ---", ""])

    (component_root / "THIRD_PARTY_NOTICES.txt").write_text(
        "\n".join(lines).rstrip() + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"Wrote third-party inventory for {len(package_records)} packages to {component_root}."
    )


if __name__ == "__main__":
    main()
