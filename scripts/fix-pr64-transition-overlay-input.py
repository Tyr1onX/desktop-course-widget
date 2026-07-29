from pathlib import Path

path = Path('src/widget-page.ts')
source = path.read_text(encoding='utf-8')
before = '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHELL_FORM_MS = 1900
const COURSE_SHELL_FORM_DELAY_MS = 360
const COURSE_SHARED_REFLOW_MS = 2800
const COURSE_FINAL_WIPE_MS = 680
const COURSE_FINAL_REVEAL_MS = 500
const COURSE_TEXT_HANDOFF_MS = 430
const COURSE_RESIZE_MS = 2800'''
after = '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHELL_FORM_DELAY_MS = 360
const COURSE_SHELL_FORM_MS = 1100
const COURSE_SHARED_REFLOW_MS = 2800
const COURSE_FINAL_WIPE_MS = 660
const COURSE_FINAL_REVEAL_MS = 480
const COURSE_TEXT_HANDOFF_MS = 460
const COURSE_RESIZE_MS = 2800'''
count = source.count(before)
if count != 1:
    raise RuntimeError(f'Expected one current transition timing block, found {count}')
path.write_text(source.replace(before, after, 1), encoding='utf-8')
