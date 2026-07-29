from pathlib import Path

path = Path('scripts/check-presentation-clock.mjs')
source = path.read_text(encoding='utf-8')
before = '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS = 3200/)
assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 1800/)
assert.match(widgetPageSource, /COURSE_TIME_EXTENSION_MS = 1400/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_MS = 900/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_GAP_MS = 240/)
assert.match(widgetPageSource, /COURSE_COUNTDOWN_REVEAL_MS = 1200/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 520/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHELL_EXPAND_MS/)
assert.doesNotMatch(widgetPageSource, /COURSE_(?:PREVIEW_MOVE|PREVIEW_FADE|CARD_REVEAL|MORPH_DELAY|MORPH_TRAVEL|MORPH_CROSSFADE)_MS/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 1000/)'''
after = '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHELL_PREP_MS = 820/)
assert.match(widgetPageSource, /COURSE_SHARED_REFLOW_MS = 2600/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 760/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 620/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 520/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHARED_CLUSTER_MS|COURSE_CARD_FORM_MS|COURSE_TIME_EXTENSION_MS|COURSE_STATE_REVEAL_MS|COURSE_COUNTDOWN_REVEAL_MS/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2600/)'''
count = source.count(before)
if count != 1:
    raise RuntimeError(f'Expected one timing assertion block, found {count}')
path.write_text(source.replace(before, after, 1), encoding='utf-8')
