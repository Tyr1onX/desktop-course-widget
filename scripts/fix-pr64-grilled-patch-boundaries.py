from pathlib import Path

path = Path('scripts/patch-pr64-grilled-handoff.py')
source = path.read_text(encoding='utf-8')
replacements = [
    (
        "function elementText(root: ParentNode | null, selector: string) {''',\n    'sweep reveal helpers',",
        "''',\n    'sweep reveal helpers',",
    ),
    (
        "\n.is-course-transitioning .focus-course,''',\n    'sweep reveal styles',",
        "\n''',\n    'sweep reveal styles',",
    ),
]
for before, after in replacements:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'Expected one patch boundary to fix, found {count}: {before}')
    source = source.replace(before, after, 1)
path.write_text(source, encoding='utf-8')
