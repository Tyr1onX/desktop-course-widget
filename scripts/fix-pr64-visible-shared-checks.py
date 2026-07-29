from pathlib import Path

path = Path('scripts/check-presentation-clock.mjs')
source = path.read_text(encoding='utf-8')
old_timing = '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHELL_PREP_MS = 820/)
assert.match(widgetPageSource, /COURSE_SHARED_REFLOW_MS = 2600/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 760/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 620/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 520/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHARED_CLUSTER_MS|COURSE_CARD_FORM_MS|COURSE_TIME_EXTENSION_MS|COURSE_STATE_REVEAL_MS|COURSE_COUNTDOWN_REVEAL_MS/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2600/)'''
new_timing = '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHELL_FORM_MS = 1900/)
assert.match(widgetPageSource, /COURSE_SHELL_FORM_DELAY_MS = 360/)
assert.match(widgetPageSource, /COURSE_SHARED_REFLOW_MS = 2800/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 680/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 500/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 430/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHELL_PREP_MS|COURSE_SHARED_CLUSTER_MS|COURSE_CARD_FORM_MS|COURSE_TIME_EXTENSION_MS|COURSE_STATE_REVEAL_MS|COURSE_COUNTDOWN_REVEAL_MS/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2800/)'''
count = source.count(old_timing)
if count != 1:
    raise RuntimeError(f'Expected one stale timing block, found {count}')
source = source.replace(old_timing, new_timing, 1)
old_source = "assert.match(widgetPageSource, /source\\.classList\\.add\\('course-shared-text'\\)/)"
new_source = "assert.match(widgetPageSource, /floating\\.classList\\.add\\('course-shared-text', 'course-shared-float'\\)/)"
count = source.count(old_source)
if count != 1:
    raise RuntimeError(f'Expected one stale source assertion, found {count}')
source = source.replace(old_source, new_source, 1)
path.write_text(source, encoding='utf-8')
