from pathlib import Path

path = Path("scripts/apply_table_structure_fix.py")
text = path.read_text(encoding="utf-8")
text = text.replace(
    '    "metadata": Path("src-tauri/src/native_ocr/metadata.rs"),\n',
    '    "metadata": Path("src-tauri/src/native_ocr/metadata.rs"),\n    "support": Path("src-tauri/src/native_ocr/support.rs"),\n',
    1,
)
old = '''metadata = replace_once(
    metadata,
    '        "中心",\\n',
    '        "中心",\\n        "操场",\\n',
    "sports field location marker",
)
metadata = replace_once(
    metadata,
    '        "学期",\\n',
    '        "学期",\\n        "学分",\\n        "起止周",\\n        "上课时间",\\n        "申请时间",\\n        "编号",\\n        "调停课信息",\\n        "调、停（补）课信息",\\n',
    "non-course table headers",
)
BRANCH_FILES["metadata"].write_text(metadata, encoding="utf-8", newline="\\n")
'''
new = '''BRANCH_FILES["metadata"].write_text(metadata, encoding="utf-8", newline="\\n")

support = BRANCH_FILES["support"].read_text(encoding="utf-8")
support = replace_once(
    support,
    '        "中心",\\n',
    '        "中心",\\n        "操场",\\n',
    "sports field location marker",
)
support = replace_once(
    support,
    '        "学期",\\n',
    '        "学期",\\n        "学分",\\n        "起止周",\\n        "上课时间",\\n        "申请时间",\\n        "编号",\\n        "调停课信息",\\n        "调、停（补）课信息",\\n',
    "non-course table headers",
)
BRANCH_FILES["support"].write_text(support, encoding="utf-8", newline="\\n")
'''
if old not in text:
    raise RuntimeError("target block not found in table patch script")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8", newline="\n")
