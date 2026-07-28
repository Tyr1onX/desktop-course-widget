from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/widget.ts",
    "  closeControl: boolean\n}",
    "  closeControl: boolean\n  now?: Date\n}",
)
replace_once(
    "src/widget.ts",
    "function liveModel(options: WidgetOptions): WidgetModel {\n  const now = new Date()",
    "function liveModel(options: WidgetOptions): WidgetModel {\n  const now = options.now ? new Date(options.now) : new Date()",
)
replace_once(
    "src/widget.ts",
    "        const today = startOfDay(new Date())",
    "        const today = startOfDay(options.now ?? new Date())",
)

changelog = Path("CHANGELOG.md")
text = changelog.read_text(encoding="utf-8")
entry = "- Added a hidden time replay and presentation mode for deterministic product recording.\n"
if entry not in text:
    marker = "## Unreleased\n\n"
    if marker not in text:
        raise RuntimeError("Unreleased changelog section not found")
    changelog.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")
