from pathlib import Path

path = Path('scripts/patch-pr64-transition-overlay-cleanup.py')
source = path.read_text(encoding='utf-8')
before = 'end = check.index("assert.match(widgetPageSource, /if \\\\(!currentWidget\\\\)/)", start)'
after = 'end = check.index("assert.match(widgetPageSource, /if \\\\(!currentWidget\\\\) \\\\{", start)'
count = source.count(before)
if count != 1:
    raise RuntimeError(f'Expected one assertion end marker, found {count}')
path.write_text(source.replace(before, after, 1), encoding='utf-8')
