from pathlib import Path

GRID = Path("src-tauri/src/native_ocr/grid.rs")
METADATA = Path("src-tauri/src/native_ocr/metadata.rs")
TESTS = Path("src-tauri/src/native_ocr/table_structure_tests.rs")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one {label}, found {count}")
    return text.replace(old, new, 1)


grid = GRID.read_text(encoding="utf-8")
grid = replace_once(
    grid,
    "    has_name && (has_supporting_field || group.iter().any(token_starts_course_card))",
    "    has_name\n        && (has_supporting_field\n            || (group.len() >= 2 && group.iter().any(token_starts_course_card)))",
    "fallback card evidence",
)
GRID.write_text(grid, encoding="utf-8", newline="\n")

metadata = METADATA.read_text(encoding="utf-8")
metadata = replace_once(
    metadata,
    "                || matches!(character, '（' | '）' | '【' | '】' | '，' | '。' | '：' | '；')",
    "                || matches!(character, '【' | '】' | '，' | '。' | '：' | '；')",
    "course title punctuation trimming",
)
METADATA.write_text(metadata, encoding="utf-8", newline="\n")

tests = TESTS.read_text(encoding="utf-8")
old = '''        let tokens = vec![
            sized_token("人工智能导论及其", 120.0, 120.0, 160.0, 22.0),
            sized_token("Python应用实践", 120.0, 146.0, 160.0, 22.0),
            sized_token("周三第1-2节第1-17周", 120.0, 174.0, 180.0, 22.0),
            sized_token("左益平", 120.0, 202.0, 60.0, 22.0),
            sized_token("教3-511", 120.0, 228.0, 70.0, 22.0),
        ];'''
new = '''        let tokens = vec![
            sized_token("人工智能导论及其", 520.0, 120.0, 160.0, 22.0),
            sized_token("Python应用实践", 520.0, 146.0, 160.0, 22.0),
            sized_token("周三第1-2节第1-17周", 520.0, 174.0, 180.0, 22.0),
            sized_token("左益平", 520.0, 202.0, 60.0, 22.0),
            sized_token("教3-511", 520.0, 228.0, 70.0, 22.0),
        ];'''
tests = replace_once(tests, old, new, "weekday-three synthetic coordinates")
TESTS.write_text(tests, encoding="utf-8", newline="\n")
