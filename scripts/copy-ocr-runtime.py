from __future__ import annotations

import argparse
import ast
import shutil
from pathlib import Path

PACKAGE = "experiments.screenshot_import"
RUNTIME_ROOTS = (
    "worker",
    "runtime_probe",
    "bootstrap_probe",
)


def module_path(source_root: Path, module: str) -> Path:
    return source_root.joinpath(*module.split(".")).with_suffix(".py")


def package_init_path(source_root: Path, package: str) -> Path:
    return source_root.joinpath(*package.split("."), "__init__.py")


def relative_target(current_module: str, level: int, target: str | None) -> str:
    package_parts = current_module.split(".")[:-1]
    if level > len(package_parts):
        raise ValueError(f"invalid relative import level {level} in {current_module}")
    base = package_parts[: len(package_parts) - level + 1]
    if target:
        base.extend(target.split("."))
    return ".".join(base)


def local_imports(path: Path, module: str) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    discovered: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level:
            target = relative_target(module, node.level, node.module)
            if target.startswith(PACKAGE):
                if node.module is None:
                    for alias in node.names:
                        candidate = f"{target}.{alias.name}"
                        discovered.add(candidate)
                else:
                    discovered.add(target)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith(PACKAGE):
                    discovered.add(alias.name)
    return discovered


def resolve_runtime_modules(source_root: Path) -> list[str]:
    pending = [f"{PACKAGE}.{name}" for name in RUNTIME_ROOTS]
    resolved: set[str] = set()
    while pending:
        module = pending.pop()
        if module in resolved:
            continue
        path = module_path(source_root, module)
        if not path.is_file():
            raise FileNotFoundError(f"runtime module is missing: {module} ({path})")
        resolved.add(module)
        for imported in local_imports(path, module):
            imported_path = module_path(source_root, imported)
            if imported_path.is_file() and imported not in resolved:
                pending.append(imported)
    return sorted(resolved)


def copy_runtime(source_root: Path, destination_root: Path) -> list[str]:
    modules = resolve_runtime_modules(source_root)
    if destination_root.exists():
        shutil.rmtree(destination_root)
    destination_root.mkdir(parents=True, exist_ok=True)

    packages = {"experiments", PACKAGE}
    for module in modules:
        parts = module.split(".")
        for index in range(1, len(parts)):
            packages.add(".".join(parts[:index]))

    copied: list[str] = []
    for package in sorted(packages):
        source = package_init_path(source_root, package)
        if not source.is_file():
            continue
        destination = destination_root.join(source.relative_to(source_root))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(destination.relative_to(destination_root).as_posix())

    for module in modules:
        source = module_path(source_root, module)
        destination = destination_root.join(source.relative_to(source_root))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(destination.relative_to(destination_root).as_posix())

    forbidden = {
        "experiments/screenshot_import/cli.py",
        "experiments/screenshot_import/corpus.py",
        "experiments/screenshot_import/corpus_benchmark.py",
        "experiments/screenshot_import/synthetic.py",
        "experiments/screenshot_import/synthetic_chinese_corpus.py",
        "experiments/screenshot_import/pipeline.py",
    }
    present_forbidden = forbidden.intersection(copied)
    if present_forbidden:
        raise RuntimeError(
            "development-only OCR modules leaked into runtime: "
            + ", ".join(sorted(present_forbidden))
        )
    required = {
        "experiments/screenshot_import/worker.py",
        "experiments/screenshot_import/runtime_probe.py",
        "experiments/screenshot_import/bootstrap_probe.py",
        "experiments/screenshot_import/paddle_cpu.py",
        "experiments/screenshot_import/ocr_first_pipeline.py",
    }
    missing = required.difference(copied)
    if missing:
        raise RuntimeError("runtime closure is incomplete: " + ", ".join(sorted(missing)))
    return sorted(copied)


def main() -> int:
    parser = argparse.ArgumentParser(description="Copy only production OCR Python modules")
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--destination-root", required=True)
    args = parser.parse_args()
    copied = copy_runtime(Path(args.source_root).resolve(), Path(args.destination_root).resolve())
    print(f"Copied {len(copied)} production OCR Python files")
    for path in copied:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
