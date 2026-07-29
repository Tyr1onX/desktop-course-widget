from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label}, found {count}")
    return source.replace(before, after, 1)


def replace_between(source: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = source.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Missing start marker for {label}")
    end = source.find(end_marker, start + len(start_marker))
    if end < 0:
        raise RuntimeError(f"Missing end marker for {label}")
    return source[:start] + replacement + source[end:]


page_path = Path('src/widget-page.ts')
page = page_path.read_text(encoding='utf-8')

page = replace_once(
    page,
    '''const COURSE_EXIT_MS = 1080
const COURSE_EXIT_GAP_MS = 120
const COURSE_SHARED_TEXT_MOVE_MS = 1680
const COURSE_CARD_FORM_MS = 1880
const COURSE_DRAW_CHARACTER_MS = 360
const COURSE_DRAW_STAGGER_MS = 90
const COURSE_DRAW_FILL_DELAY_MS = 150
const COURSE_DRAW_GUIDE_MS = 760
const COURSE_TEXT_HANDOFF_MS = 120''',
    '''const COURSE_EXIT_MS = 720
const COURSE_EXIT_GAP_MS = 120
const COURSE_SHARED_CLUSTER_MS = 980
const COURSE_CARD_FORM_MS = 920
const COURSE_TIME_EXTENSION_MS = 760
const COURSE_STATE_REVEAL_MS = 520
const COURSE_STATE_REVEAL_GAP_MS = 160
const COURSE_COUNTDOWN_REVEAL_MS = 680
const COURSE_TEXT_HANDOFF_MS = 140''',
    'handoff timing constants',
)

page = replace_between(
    page,
    'function prepareDrawReveal(element: HTMLElement) {',
    'function elementText(root: ParentNode | null, selector: string) {',
    '''function prepareSweepReveal(element: HTMLElement) {
  const text = element.textContent ?? ''
  const copy = document.createElement('span')
  copy.className = 'course-sweep-copy'
  copy.textContent = text
  const edge = document.createElement('span')
  edge.className = 'course-sweep-edge'
  element.replaceChildren(copy, edge)
  element.classList.add('course-sweep-reveal')
  return { root: element, text, copy, edge }
}

function sweepRevealAnimations(
  part: ReturnType<typeof prepareSweepReveal>,
  duration: number,
  delay = 0,
) {
  const width = Math.max(1, part.root.getBoundingClientRect().width)
  return [
    animateElement(part.copy, [
      { opacity: .02, clipPath: 'inset(0 100% 0 0)' },
      { offset: .18, opacity: .18, clipPath: 'inset(0 88% 0 0)' },
      { offset: .72, opacity: .92, clipPath: 'inset(0 16% 0 0)' },
      { opacity: 1, clipPath: 'inset(0 0 0 0)' },
    ], {
      duration,
      delay,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    }),
    animateElement(part.edge, [
      { opacity: 0, transform: 'translate3d(0, 0, 0) scaleY(.55)' },
      { offset: .08, opacity: .68, transform: 'translate3d(0, 0, 0) scaleY(.78)' },
      { offset: .82, opacity: .72, transform: `translate3d(${Math.max(0, width - 2)}px, 0, 0) scaleY(1)` },
      { opacity: 0, transform: `translate3d(${Math.max(0, width - 2)}px, 0, 0) scaleY(.72)` },
    ], {
      duration,
      delay,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    }),
  ]
}

function elementText(root: ParentNode | null, selector: string) {''',
    'sweep reveal helpers',
)

shared_replacement = '''  const sourceTitle = sharedSource.querySelector<HTMLElement>('strong')
  const sourceLocation = sharedSource.querySelector<HTMLElement>('small')
  const sourceTime = sharedSource.querySelector<HTMLElement>('time')
  const stageRect = stage.getBoundingClientRect()
  const targetRect = targetPrimary.getBoundingClientRect()
  const targetStyle = getComputedStyle(targetPrimary)
  const targetLocation = targetPrimary.querySelector<HTMLElement>('.course-location')
  const targetLocationRect = targetLocation?.getBoundingClientRect()
  const compactHeight = Math.min(
    targetRect.height,
    Math.max(62, (targetLocationRect?.bottom ?? targetRect.top + 62) - targetRect.top + 10),
  )
  const compactBottomInset = Math.max(0, 100 - (compactHeight / Math.max(1, targetRect.height)) * 100)

  const morph = document.createElement('div')
  morph.className = 'course-shared-morph'
  morph.style.left = `${targetRect.left - stageRect.left}px`
  morph.style.top = `${targetRect.top - stageRect.top}px`
  morph.style.width = `${targetRect.width}px`
  morph.style.height = `${targetRect.height}px`
  morph.style.borderRadius = targetStyle.borderRadius

  const surface = targetPrimary.cloneNode(false) as HTMLElement
  surface.classList.add('course-morph-surface')
  surface.style.opacity = '0'
  surface.style.clipPath = `inset(0 46% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})`
  const targetLayer = targetPrimary.cloneNode(true) as HTMLElement
  targetLayer.classList.add('course-morph-target')
  targetLayer.style.opacity = '1'
  const targetTitleCopy = targetLayer.querySelector<HTMLElement>('h2')
  const targetLocationCopy = targetLayer.querySelector<HTMLElement>('.course-location')
  const targetTimeCopy = targetLayer.querySelector<HTMLElement>('.course-time')
  const fullTargetTime = targetTimeCopy?.textContent?.trim() ?? ''
  const [targetStartTime = '', ...targetEndParts] = fullTargetTime.split(/[–-]/)
  const targetEndTime = targetEndParts.join('–').trim()
  let targetTimePrefix: HTMLElement | null = null
  let targetTimeExtension: HTMLElement | null = null
  if (targetTimeCopy && targetStartTime) {
    targetTimeCopy.classList.add('is-shared-time-range')
    targetTimePrefix = document.createElement('span')
    targetTimePrefix.className = 'course-time-shared-prefix is-shared-copy-hidden'
    targetTimePrefix.textContent = targetStartTime.trim()
    targetTimeExtension = document.createElement('span')
    targetTimeExtension.className = 'course-time-extension'
    targetTimeExtension.textContent = targetEndTime ? `–${targetEndTime}` : ''
    targetTimeCopy.replaceChildren(targetTimePrefix, targetTimeExtension)
  }

  const targetCopies = [targetTitleCopy, targetLocationCopy, targetTimePrefix]
    .filter((copy): copy is HTMLElement => Boolean(copy))
  targetCopies.forEach((copy) => copy.classList.add('is-shared-copy-hidden'))

  const timeSweep = targetTimeExtension ? prepareSweepReveal(targetTimeExtension) : null
  const stateElement = targetLayer.querySelector<HTMLElement>('.focus-kicker')
  const countdownElement = targetLayer.querySelector<HTMLElement>('.countdown')
  const stateSweep = stateElement ? prepareSweepReveal(stateElement) : null
  const countdownSweep = countdownElement ? prepareSweepReveal(countdownElement) : null
  const supportingParts = Array.from(targetLayer.querySelectorAll<HTMLElement>('.course-date, .course-flow'))
  ;[timeSweep, stateSweep, countdownSweep]
    .filter((part): part is ReturnType<typeof prepareSweepReveal> => Boolean(part))
    .forEach(({ copy, edge }) => {
      copy.style.opacity = '0'
      copy.style.clipPath = 'inset(0 100% 0 0)'
      edge.style.opacity = '0'
    })
  supportingParts.forEach((part) => {
    part.style.opacity = '0'
    part.style.transform = 'translateY(5px)'
  })

  morph.append(surface, targetLayer)
  stage.append(morph)
  await nextAnimationFrame()
  if (token !== transitionToken) return

  const titleMotion = sharedTextMotion(sourceTitle, targetTitleCopy)
  const locationMotion = sharedTextMotion(sourceLocation, targetLocationCopy)
  const timeMotion = sharedTextMotion(sourceTime, targetTimePrefix)
  const sharedMotions = [titleMotion, locationMotion, timeMotion]
    .filter((motion): motion is NonNullable<typeof motion> => Boolean(motion))
  const cardFormDelay = Math.round(COURSE_SHARED_CLUSTER_MS * .28)
  const timeExtensionDelay = Math.round(COURSE_SHARED_CLUSTER_MS * .46)

  await Promise.all([
    ...sharedMotions.map((motion, index) => animateElement(
      motion.element,
      motion.keyframes,
      {
        duration: COURSE_SHARED_CLUSTER_MS,
        delay: index * 36,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      },
    )),
    animateElement(surface, [
      { opacity: 0, clipPath: `inset(0 46% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
      { offset: .24, opacity: .08, clipPath: `inset(0 34% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
      { offset: .66, opacity: .68, clipPath: `inset(0 0 ${compactBottomInset * .36}% 0 round ${targetStyle.borderRadius})` },
      { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
    ], {
      duration: COURSE_CARD_FORM_MS,
      delay: cardFormDelay,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    }),
    ...(timeSweep ? sweepRevealAnimations(timeSweep, COURSE_TIME_EXTENSION_MS, timeExtensionDelay) : []),
  ])
  if (token !== transitionToken) return

  if (stateSweep) {
    await Promise.all(sweepRevealAnimations(stateSweep, COURSE_STATE_REVEAL_MS))
    if (token !== transitionToken) return
  }

  if (stateSweep && countdownSweep) {
    await transitionDelay(COURSE_STATE_REVEAL_GAP_MS)
    if (token !== transitionToken) return
  }

  await Promise.all([
    ...(countdownSweep ? sweepRevealAnimations(countdownSweep, COURSE_COUNTDOWN_REVEAL_MS) : []),
    ...supportingParts.map((part, index) => animateElement(part, [
      { opacity: 0, transform: 'translateY(5px)' },
      { offset: .38, opacity: .16, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: COURSE_COUNTDOWN_REVEAL_MS,
      delay: 80 + index * 70,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    })),
  ])
  if (token !== transitionToken) return

  targetCopies.forEach((copy) => {
    copy.classList.remove('is-shared-copy-hidden')
    copy.style.opacity = '0'
  })
  await Promise.all([
    ...sharedMotions.map((motion) => animateElement(motion.element, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: COURSE_TEXT_HANDOFF_MS, easing: 'linear', fill: 'both' })),
    ...targetCopies.map((copy) => animateElement(copy, [
      { opacity: 0 },
      { opacity: 1 },
    ], { duration: COURSE_TEXT_HANDOFF_MS, easing: 'linear', fill: 'both' })),
  ])
  if (token !== transitionToken) return

  targetCopies.forEach((copy) => {
    clearElementAnimations(copy)
    copy.style.removeProperty('opacity')
  })
  ;[timeSweep, stateSweep, countdownSweep]
    .filter((part): part is ReturnType<typeof prepareSweepReveal> => Boolean(part))
    .forEach(({ root, text, copy, edge }) => {
      clearElementAnimations(copy)
      clearElementAnimations(edge)
      root.classList.remove('course-sweep-reveal')
      root.textContent = text
    })
  supportingParts.forEach((part) => {
    clearElementAnimations(part)
    part.style.removeProperty('opacity')
    part.style.removeProperty('transform')
  })
  if (targetTimeCopy) {
    targetTimeCopy.classList.remove('is-shared-time-range')
    targetTimeCopy.textContent = fullTargetTime
  }
  targetPrimary.replaceWith(targetLayer)
  targetLayer.classList.remove('course-morph-target')
  targetLayer.style.removeProperty('opacity')
  morph.remove()
'''

page = replace_between(
    page,
    "  const sourceTitle = sharedSource.querySelector<HTMLElement>('strong')",
    '  } else {',
    shared_replacement,
    'shared-course choreography',
)

for legacy in (
    'prepareDrawReveal',
    'drawRevealAnimations',
    'COURSE_DRAW_CHARACTER_MS',
    'COURSE_DRAW_STAGGER_MS',
    'COURSE_DRAW_FILL_DELAY_MS',
    'COURSE_DRAW_GUIDE_MS',
    'course-drawn-character',
):
    if legacy in page:
        raise RuntimeError(f'Legacy glyph drawing implementation remains: {legacy}')

if 'sharedTextMotion(sourceTime, targetTimePrefix)' not in page:
    raise RuntimeError('Shared start time is not paired with the exact final prefix')
page_path.write_text(page, encoding='utf-8')


css_path = Path('src/widget-page.css')
css = css_path.read_text(encoding='utf-8')
css = replace_between(
    css,
    '.course-morph-target .course-time.is-shared-time-range {',
    '.is-course-transitioning .focus-course,',
    '''.course-morph-target .course-time.is-shared-time-range {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
  white-space: nowrap;
}

.course-time-shared-prefix,
.course-time-extension {
  display: inline-flex;
  align-items: baseline;
  margin: 0;
  padding: 0;
  font: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  font-variant-numeric: inherit;
  vertical-align: baseline;
  transform-origin: left baseline;
}

.course-time-extension.course-sweep-reveal { display: inline-flex; }
.course-sweep-reveal {
  position: relative;
  width: max-content;
  max-width: 100%;
  overflow: hidden;
  white-space: pre;
}
.course-sweep-copy {
  display: inline-block;
  white-space: pre;
  will-change: clip-path, opacity;
}
.course-sweep-edge {
  position: absolute;
  inset: 10% auto 10% 0;
  width: 1.5px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 6px rgba(var(--identity-accent-rgb), .28);
  pointer-events: none;
  transform-origin: center;
  will-change: transform, opacity;
}

.is-course-transitioning .focus-course,''',
    'sweep reveal styles',
)
for legacy in ('course-draw-guide', 'course-drawn-character', '-webkit-text-stroke'):
    if legacy in css:
        raise RuntimeError(f'Legacy glyph drawing CSS remains: {legacy}')
css_path.write_text(css, encoding='utf-8')


check_path = Path('scripts/check-presentation-clock.mjs')
check = check_path.read_text(encoding='utf-8')
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 1080/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 120/)
assert.match(widgetPageSource, /COURSE_SHARED_TEXT_MOVE_MS = 1680/)
assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 1880/)
assert.match(widgetPageSource, /COURSE_DRAW_CHARACTER_MS = 360/)
assert.match(widgetPageSource, /COURSE_DRAW_STAGGER_MS = 90/)
assert.match(widgetPageSource, /COURSE_DRAW_FILL_DELAY_MS = 150/)
assert.match(widgetPageSource, /COURSE_DRAW_GUIDE_MS = 760/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 120/)''',
    '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 720/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 120/)
assert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS = 980/)
assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 920/)
assert.match(widgetPageSource, /COURSE_TIME_EXTENSION_MS = 760/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_MS = 520/)
assert.match(widgetPageSource, /COURSE_STATE_REVEAL_GAP_MS = 160/)
assert.match(widgetPageSource, /COURSE_COUNTDOWN_REVEAL_MS = 680/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 140/)''',
    'timing assertions',
)
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /function prepareDrawReveal/)
assert.match(widgetPageSource, /function drawRevealAnimations/)''',
    '''assert.match(widgetPageSource, /function prepareSweepReveal/)
assert.match(widgetPageSource, /function sweepRevealAnimations/)''',
    'helper assertions',
)
check = replace_once(
    check,
    "assert.match(widgetPageSource, /const timeMotion = sharedTextMotion\\(sourceTime, targetTime\\)/)",
    "assert.match(widgetPageSource, /const timeMotion = sharedTextMotion\\(sourceTime, targetTimePrefix\\)/)",
    'shared time assertion',
)
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /drawRevealParts/)
assert.match(widgetPageSource, /softRevealParts/)
assert.match(widgetPageSource, /course-draw-guide/)
assert.match(widgetPageSource, /course-drawn-character-outline/)
assert.match(widgetPageSource, /course-drawn-character-fill/)
assert.match(widgetPageSource, /Array\.from\(text\)\.map/)
assert.match(widgetPageSource, /clipPath: 'inset\(0 100% 0 0\)'/)
assert.doesNotMatch(widgetPageSource, /prepareLineReveal|lineRevealParts|COURSE_LINE_REVEAL_MS/)
assert.match(widgetPageSource, /characterIndex \* COURSE_DRAW_STAGGER_MS/)
assert.match(widgetPageSource, /characterDelay \+ COURSE_DRAW_FILL_DELAY_MS/)
assert.match(widgetPageSource, /await Promise\.all\(\[[\s\S]*sharedMotions\.map[\s\S]*animateElement\(morph[\s\S]*drawRevealParts\.flatMap\(drawRevealAnimations\)/)
assert.match(widgetPageSource, /duration: COURSE_SHARED_TEXT_MOVE_MS/)
assert.match(widgetPageSource, /duration: COURSE_CARD_FORM_MS/)''',
    '''assert.match(widgetPageSource, /const timeSweep = targetTimeExtension \? prepareSweepReveal/)
assert.match(widgetPageSource, /const stateSweep = stateElement \? prepareSweepReveal/)
assert.match(widgetPageSource, /const countdownSweep = countdownElement \? prepareSweepReveal/)
assert.match(widgetPageSource, /course-sweep-copy/)
assert.match(widgetPageSource, /course-sweep-edge/)
assert.match(widgetPageSource, /clipPath: 'inset\(0 100% 0 0\)'/)
assert.doesNotMatch(widgetPageSource, /prepareDrawReveal|drawRevealAnimations|COURSE_DRAW_/)
assert.match(widgetPageSource, /await Promise\.all\(\[[\s\S]*sharedMotions\.map[\s\S]*animateElement\(surface[\s\S]*timeSweep/)
assert.match(widgetPageSource, /duration: COURSE_SHARED_CLUSTER_MS/)
assert.match(widgetPageSource, /duration: COURSE_CARD_FORM_MS/)
assert.match(widgetPageSource, /await transitionDelay\(COURSE_STATE_REVEAL_GAP_MS\)/)
assert.match(widgetPageSource, /COURSE_COUNTDOWN_REVEAL_MS/)''',
    'choreography assertions',
)
check = replace_once(
    check,
    '''assert.match(widgetPageCss, /\.course-time-extension/)
assert.match(widgetPageCss, /\.course-draw-guide/)
assert.match(widgetPageCss, /\.course-drawn-character-outline/)
assert.match(widgetPageCss, /-webkit-text-fill-color: transparent/)
assert.match(widgetPageCss, /will-change: clip-path, opacity, filter, transform/)''',
    '''assert.match(widgetPageCss, /\.course-time-extension/)
assert.match(widgetPageCss, /\.course-sweep-reveal/)
assert.match(widgetPageCss, /\.course-sweep-copy/)
assert.match(widgetPageCss, /\.course-sweep-edge/)
assert.match(widgetPageCss, /width: max-content/)
assert.doesNotMatch(widgetPageCss, /course-drawn-character|-webkit-text-stroke/)''',
    'CSS assertions',
)
check = replace_once(
    check,
    "console.log('presentation clock, baseline-aligned shared time, slow per-character outline drawing, duration formatting, controller, and widget wiring checks passed')",
    "console.log('presentation clock, exact shared-time alignment, staged shared-cluster promotion, sweep reveals, duration formatting, controller, and widget wiring checks passed')",
    'check summary',
)
check_path.write_text(check, encoding='utf-8')
