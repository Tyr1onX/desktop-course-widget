from __future__ import annotations

import argparse
import importlib.metadata
import json
import re
import sys
from pathlib import Path

_PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s]+)$")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def read_lock(path: Path) -> dict[str, tuple[str, str]]:
    locked: dict[str, tuple[str, str]] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = _PIN.fullmatch(line)
        if not match:
            raise SystemExit(f"{path}:{number}: expected an exact name==version pin")
        display_name, version = match.groups()
        key = normalize(display_name)
        if key in locked:
            raise SystemExit(f"{path}:{number}: duplicate package pin: {display_name}")
        locked[key] = (display_name, version)
    if not locked:
        raise SystemExit(f"{path}: lock file contains no package pins")
    return locked


def read_report(path: Path) -> dict[str, tuple[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    resolved: dict[str, tuple[str, str]] = {}
    for entry in payload.get("install", []):
        metadata = entry.get("metadata") or {}
        display_name = metadata.get("name")
        version = metadata.get("version")
        if not isinstance(display_name, str) or not isinstance(version, str):
            raise SystemExit("pip report contains an install entry without package name/version")
        key = normalize(display_name)
        if key in resolved:
            raise SystemExit(f"pip report contains duplicate package: {display_name}")
        resolved[key] = (display_name, version)
    if not resolved:
        raise SystemExit("pip report contains no installed packages")
    return resolved


def read_installed(site_packages: Path) -> tuple[dict[str, tuple[str, str]], dict[str, importlib.metadata.Distribution]]:
    installed: dict[str, tuple[str, str]] = {}
    distributions: dict[str, importlib.metadata.Distribution] = {}
    for distribution in importlib.metadata.distributions(path=[str(site_packages)]):
        display_name = distribution.metadata.get("Name")
        version = distribution.version
        if not display_name or not version:
            raise SystemExit(f"installed distribution is missing name/version: {distribution}")
        key = normalize(display_name)
        if key in installed:
            raise SystemExit(f"site-packages contains duplicate distribution metadata: {display_name}")
        installed[key] = (display_name, version)
        distributions[key] = distribution
    if not installed:
        raise SystemExit(f"{site_packages}: no installed distributions found")
    return installed, distributions


def compare_sets(
    label: str,
    locked: dict[str, tuple[str, str]],
    actual: dict[str, tuple[str, str]],
) -> list[str]:
    errors: list[str] = []
    for key in sorted(locked.keys() - actual.keys()):
        errors.append(f"missing from {label}: {locked[key][0]}=={locked[key][1]}")
    for key in sorted(actual.keys() - locked.keys()):
        errors.append(f"not pinned in lock file ({label}): {actual[key][0]}=={actual[key][1]}")
    for key in sorted(locked.keys() & actual.keys()):
        expected = locked[key][1]
        observed = actual[key][1]
        if expected != observed:
            errors.append(
                f"version mismatch for {locked[key][0]} in {label}: expected {expected}, got {observed}"
            )
    return errors


def verify_dependency_metadata(
    installed: dict[str, tuple[str, str]],
    distributions: dict[str, importlib.metadata.Distribution],
    site_packages: Path,
) -> list[str]:
    sys.path.insert(0, str(site_packages))
    try:
        from packaging.markers import default_environment
        from packaging.requirements import Requirement
        from packaging.version import Version
    finally:
        sys.path.pop(0)

    environment = default_environment()
    errors: list[str] = []
    for key in sorted(distributions):
        distribution = distributions[key]
        for raw_requirement in distribution.requires or []:
            try:
                requirement = Requirement(raw_requirement)
            except Exception as error:
                errors.append(f"invalid dependency metadata for {installed[key][0]}: {raw_requirement!r}: {error}")
                continue
            if requirement.marker is not None:
                marker_environment = dict(environment)
                marker_environment["extra"] = ""
                if not requirement.marker.evaluate(marker_environment):
                    continue
            dependency_key = normalize(requirement.name)
            dependency = installed.get(dependency_key)
            if dependency is None:
                errors.append(
                    f"unsatisfied dependency for {installed[key][0]}: {requirement.name}{requirement.specifier}"
                )
                continue
            if requirement.specifier and Version(dependency[1]) not in requirement.specifier:
                errors.append(
                    f"incompatible dependency for {installed[key][0]}: "
                    f"{requirement.name}{requirement.specifier}, installed {dependency[1]}"
                )
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--site-packages", type=Path, required=True)
    args = parser.parse_args()

    locked = read_lock(args.lock)
    resolved = read_report(args.report)
    installed, distributions = read_installed(args.site_packages)

    errors = compare_sets("pip report", locked, resolved)
    errors.extend(compare_sets("site-packages", locked, installed))
    errors.extend(verify_dependency_metadata(installed, distributions, args.site_packages))
    if errors:
        raise SystemExit("OCR dependency lock mismatch:\n- " + "\n- ".join(errors))
    print(
        f"Verified {len(locked)} exactly pinned OCR component packages and their dependency metadata."
    )


if __name__ == "__main__":
    main()
