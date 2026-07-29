from pathlib import Path

path = Path('scripts/check-presentation-clock.mjs')
source = path.read_text(encoding='utf-8')
replacements = [
    (
        "assert.match(widgetPageSource, /const targetTitle = targetPrimary\\.querySelector<HTMLElement>\\('h2'\\)/)",
        "assert.match(widgetPageSource, /const targetTitleCopy = targetLayer\\.querySelector<HTMLElement>\\('h2'\\)/)",
    ),
    (
        "assert.match(widgetPageSource, /const targetLocation = targetPrimary\\.querySelector<HTMLElement>\\('\\.course-location'\\)/)",
        "assert.match(widgetPageSource, /const targetLocationCopy = targetLayer\\.querySelector<HTMLElement>\\('\\.course-location'\\)/)",
    ),
    (
        "assert.match(widgetPageSource, /const targetTime = targetPrimary\\.querySelector<HTMLElement>\\('\\.course-time'\\)/)",
        "assert.match(widgetPageSource, /const targetTimeCopy = targetLayer\\.querySelector<HTMLElement>\\('\\.course-time'\\)/)",
    ),
]
for before, after in replacements:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'Expected one assertion to replace, found {count}: {before}')
    source = source.replace(before, after, 1)
path.write_text(source, encoding='utf-8')
