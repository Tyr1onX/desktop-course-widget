from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'Expected one {label}, found {count}')
    return source.replace(before, after, 1)


page_path = Path('src/widget-page.ts')
page = page_path.read_text(encoding='utf-8')
page = replace_once(
    page,
    '''const COURSE_EXIT_MS = 720
const COURSE_EXIT_GAP_MS = 120
const COURSE_SHARED_CLUSTER_MS = 980
const COURSE_CARD_FORM_MS = 920
const COURSE_TIME_EXTENSION_MS = 760
const COURSE_STATE_REVEAL_MS = 520
const COURSE_STATE_REVEAL_GAP_MS = 160
const COURSE_COUNTDOWN_REVEAL_MS = 680
const COURSE_TEXT_HANDOFF_MS = 140''',
    '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHARED_CLUSTER_MS = 3200
const COURSE_CARD_FORM_MS = 1800
const COURSE_TIME_EXTENSION_MS = 1400
const COURSE_STATE_REVEAL_MS = 900
const COURSE_STATE_REVEAL_GAP_MS = 240
const COURSE_COUNTDOWN_REVEAL_MS = 1200
const COURSE_TEXT_HANDOFF_MS = 520''',
    'handoff timing constants',
)
page = replace_once(
    page,
    '''    keyframes: [
      { opacity: 1, color: sourceStyle.color, transform: 'translate3d(0, 0, 0) scale(1)' },
      {
        offset: .38,
        opacity: 1,
        color: targetStyle.color,
        transform: `translate3d(${deltaX * .46}px, ${deltaY * .34 - 5}px, 0) scale(${1 + (scale - 1) * .38})`,
      },
      {
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`,
      },
    ] satisfies Keyframe[],''',
    '''    keyframes: [
      { opacity: 1, color: sourceStyle.color, transform: 'translate3d(0, 0, 0) scale(1)' },
      {
        offset: .2,
        opacity: 1,
        color: sourceStyle.color,
        transform: `translate3d(${deltaX * .1}px, ${deltaY * .1}px, 0) scale(${1 + (scale - 1) * .12})`,
      },
      {
        offset: .46,
        opacity: 1,
        color: targetStyle.color,
        transform: `translate3d(${deltaX * .43}px, ${deltaY * .43 - 3}px, 0) scale(${1 + (scale - 1) * .46})`,
      },
      {
        offset: .76,
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX * .8}px, ${deltaY * .8}px, 0) scale(${1 + (scale - 1) * .82})`,
      },
      {
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`,
      },
    ] satisfies Keyframe[],''',
    'shared text motion keyframes',
)
page = replace_once(
    page,
    '''  const cardFormDelay = Math.round(COURSE_SHARED_CLUSTER_MS * .28)
  const timeExtensionDelay = Math.round(COURSE_SHARED_CLUSTER_MS * .46)''',
    '''  const cardFormDelay = Math.round(COURSE_SHARED_CLUSTER_MS * .58)
  const timeExtensionDelay = Math.round(COURSE_SHARED_CLUSTER_MS * .72)''',
    'staged reveal delays',
)
page = replace_once(
    page,
    '''        duration: COURSE_SHARED_CLUSTER_MS,
        delay: index * 36,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',''',
    '''        duration: COURSE_SHARED_CLUSTER_MS,
        delay: 0,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',''',
    'shared cluster animation options',
)
page = replace_once(
    page,
    '''    ...sharedMotions.map((motion) => animateElement(motion.element, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: COURSE_TEXT_HANDOFF_MS, easing: 'linear', fill: 'both' })),
    ...targetCopies.map((copy) => animateElement(copy, [
      { opacity: 0 },
      { opacity: 1 },
    ], { duration: COURSE_TEXT_HANDOFF_MS, easing: 'linear', fill: 'both' })),''',
    '''    ...sharedMotions.map((motion) => animateElement(motion.element, [
      { opacity: 1 },
      { offset: .54, opacity: .92 },
      { opacity: 0 },
    ], { duration: COURSE_TEXT_HANDOFF_MS, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' })),
    ...targetCopies.map((copy) => animateElement(copy, [
      { opacity: 0 },
      { offset: .34, opacity: .06 },
      { opacity: 1 },
    ], { duration: COURSE_TEXT_HANDOFF_MS, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' })),''',
    'shared text handoff',
)
page_path.write_text(page, encoding='utf-8')

check_path = Path('scripts/check-presentation-clock.mjs')
check = check_path.read_text(encoding='utf-8')
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 720/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 120/)
assert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS = 980/)
assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 920/)
assert.match(widgetPageSource, /COURSE_TIME_EXTENSION_MS = 760/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_MS = 520/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_GAP_MS = 160/)
assert.match(widgetPageSource, /COURSE_COUNTDOWN_REVEAL_MS = 680/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 140/)''',
    '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS = 3200/)
assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 1800/)
assert.match(widgetPageSource, /COURSE_TIME_EXTENSION_MS = 1400/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_MS = 900/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_GAP_MS = 240/)
assert.match(widgetPageSource, /COURSE_COUNTDOWN_REVEAL_MS = 1200/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 520/)''',
    'timing assertions',
)
anchor = "assert.match(widgetPageSource, /duration: COURSE_SHARED_CLUSTER_MS/)"
check = replace_once(
    check,
    anchor,
    anchor + "\nassert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS \\* \\.58/)\nassert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS \\* \\.72/)\nassert.match(widgetPageSource, /offset: \\.76/[\\s\\S]*deltaX \\* \\.8/)\nassert.match(widgetPageSource, /delay: 0/[\\s\\S]*cubic-bezier\\(\\.2, \\.62, \\.18, 1\\)/)",
    'visible motion assertions',
)
check = check.replace(
    'exact shared-time alignment, staged shared-cluster promotion, sweep reveals',
    'exact shared-time alignment, visibly paced shared-cluster promotion, delayed shell formation, sweep reveals',
)
check_path.write_text(check, encoding='utf-8')
