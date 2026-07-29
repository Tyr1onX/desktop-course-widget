from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label}, found {count}")
    return source.replace(before, after, 1)


def replace_range(source: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = source.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Missing start for {label}")
    if source.find(start_marker, start + len(start_marker)) >= 0:
        raise RuntimeError(f"Ambiguous start for {label}")
    end = source.find(end_marker, start + len(start_marker))
    if end < 0:
        raise RuntimeError(f"Missing end for {label}")
    return source[:start] + replacement + source[end + len(end_marker):]


page_path = Path('src/widget-page.ts')
page = page_path.read_text(encoding='utf-8')

page = replace_once(
    page,
    '''const COURSE_SHARED_TEXT_MOVE_MS = 1120
const COURSE_CARD_FORM_MS = 1120
const COURSE_LINE_REVEAL_MS = 820
const COURSE_TEXT_HANDOFF_MS = 90''',
    '''const COURSE_SHARED_TEXT_MOVE_MS = 1680
const COURSE_CARD_FORM_MS = 1880
const COURSE_DRAW_CHARACTER_MS = 360
const COURSE_DRAW_STAGGER_MS = 90
const COURSE_DRAW_FILL_DELAY_MS = 150
const COURSE_DRAW_GUIDE_MS = 760
const COURSE_TEXT_HANDOFF_MS = 120''',
    'animation timings',
)

page = replace_range(
    page,
    'function prepareLineReveal(element: HTMLElement) {',
    'function elementText(root: ParentNode | null, selector: string) {',
    '''function prepareDrawReveal(element: HTMLElement) {
  const text = element.textContent ?? ''
  const guide = document.createElement('span')
  guide.className = 'course-draw-guide'
  const characters = Array.from(text).map((character) => {
    const root = document.createElement('span')
    root.className = 'course-drawn-character'
    const outline = document.createElement('span')
    outline.className = 'course-drawn-character-outline'
    const fill = document.createElement('span')
    fill.className = 'course-drawn-character-fill'
    const visibleCharacter = character === ' ' ? '\\u00a0' : character
    outline.textContent = visibleCharacter
    fill.textContent = visibleCharacter
    root.append(outline, fill)
    return { root, outline, fill }
  })
  element.replaceChildren(guide, ...characters.map(({ root }) => root))
  element.classList.add('course-draw-reveal')
  return { root: element, text, guide, characters }
}

function drawRevealAnimations(part: ReturnType<typeof prepareDrawReveal>, groupIndex: number) {
  const groupDelay = 260 + groupIndex * 160
  const animations = [animateElement(part.guide, [
    { opacity: .12, transform: 'scaleX(.03)' },
    { offset: .66, opacity: .5, transform: 'scaleX(1)' },
    { opacity: 0, transform: 'scaleX(1)' },
  ], {
    duration: COURSE_DRAW_GUIDE_MS,
    delay: groupDelay,
    easing: 'cubic-bezier(.22, 1, .36, 1)',
    fill: 'both',
  })]

  part.characters.forEach(({ outline, fill }, characterIndex) => {
    const characterDelay = groupDelay + 180 + characterIndex * COURSE_DRAW_STAGGER_MS
    animations.push(
      animateElement(outline, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', filter: 'blur(.8px)', transform: 'translateX(-1px)' },
        { offset: .56, opacity: .78, clipPath: 'inset(0 0 0 0)', filter: 'blur(0)', transform: 'translateX(0)' },
        { opacity: .3, clipPath: 'inset(0 0 0 0)', filter: 'blur(0)', transform: 'translateX(0)' },
      ], {
        duration: COURSE_DRAW_CHARACTER_MS,
        delay: characterDelay,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      }),
      animateElement(fill, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', filter: 'blur(.45px)' },
        { offset: .34, opacity: .08, clipPath: 'inset(0 72% 0 0)', filter: 'blur(.3px)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)', filter: 'blur(0)' },
      ], {
        duration: Math.max(260, COURSE_DRAW_CHARACTER_MS - 40),
        delay: characterDelay + COURSE_DRAW_FILL_DELAY_MS,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      }),
    )
  })

  return animations
}

function elementText(root: ParentNode | null, selector: string) {''',
    'draw reveal helpers',
)

page = replace_range(
    page,
    "  const targetTitleCopy = targetLayer.querySelector<HTMLElement>('h2')",
    '  stage.append(morph)',
    '''  const targetTitleCopy = targetLayer.querySelector<HTMLElement>('h2')
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
  const drawRevealParts = [
    targetTimeExtension ? prepareDrawReveal(targetTimeExtension) : null,
    ...Array.from(targetLayer.querySelectorAll<HTMLElement>('.focus-kicker, .countdown')).map(prepareDrawReveal),
  ].filter((part): part is ReturnType<typeof prepareDrawReveal> => Boolean(part))
  const softRevealParts = Array.from(targetLayer.querySelectorAll<HTMLElement>('.course-date, .course-flow'))
  drawRevealParts.forEach(({ guide, characters }) => {
    guide.style.opacity = '.12'
    guide.style.transform = 'scaleX(.03)'
    characters.forEach(({ outline, fill }) => {
      outline.style.opacity = '0'
      outline.style.clipPath = 'inset(0 100% 0 0)'
      fill.style.opacity = '0'
      fill.style.clipPath = 'inset(0 100% 0 0)'
    })
  })
  softRevealParts.forEach((part) => {
    part.style.opacity = '0'
    part.style.clipPath = 'inset(0 100% 0 0)'
    part.style.transform = 'translateY(5px)'
  })
  morph.append(surface, targetLayer)
  stage.append(morph)''',
    'target draw setup',
)

page = replace_range(
    page,
    '''  await Promise.all([
    ...sharedMotions.map((motion, index) => animateElement(''',
    '''  ])
  if (token !== transitionToken) return''',
    '''  await Promise.all([
    ...sharedMotions.map((motion, index) => animateElement(
      motion.element,
      motion.keyframes,
      {
        duration: COURSE_SHARED_TEXT_MOVE_MS,
        delay: index * 70,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      },
    )),
    animateElement(morph, [
      { height: `${compactHeight}px` },
      { offset: .34, height: `${compactHeight}px` },
      { height: `${targetRect.height}px` },
    ], { duration: COURSE_CARD_FORM_MS, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' }),
    animateElement(surface, [
      { opacity: 0 },
      { offset: .22, opacity: .03 },
      { offset: .62, opacity: .52 },
      { opacity: 1 },
    ], { duration: COURSE_CARD_FORM_MS, easing: 'ease-out', fill: 'both' }),
    ...drawRevealParts.flatMap(drawRevealAnimations),
    ...softRevealParts.map((part, index) => animateElement(part, [
      { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: 'translateY(5px)' },
      { offset: .46, opacity: .18, clipPath: 'inset(0 68% 0 0)', transform: 'translateY(3px)' },
      { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' },
    ], {
      duration: 1280,
      delay: 460 + index * 120,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    })),
  ])
  if (token !== transitionToken) return''',
    'parallel draw animation',
)

page = replace_range(
    page,
    '  lineRevealParts.forEach(({ root, stroke, copy }) => {',
    '''})
  softRevealParts.forEach((part) => {''',
    '''  drawRevealParts.forEach(({ root, text, guide, characters }) => {
    clearElementAnimations(guide)
    characters.forEach(({ outline, fill }) => {
      clearElementAnimations(outline)
      clearElementAnimations(fill)
    })
    root.classList.remove('course-draw-reveal')
    root.textContent = text
  })
  softRevealParts.forEach((part) => {''',
    'draw cleanup',
)

page = replace_once(
    page,
    '''  if (targetTimeExtension) clearElementAnimations(targetTimeExtension)
  if (targetTimeCopy) targetTimeCopy.textContent = fullTargetTime''',
    '  if (targetTimeCopy) targetTimeCopy.textContent = fullTargetTime',
    'legacy time extension cleanup',
)

for legacy in ('prepareLineReveal', 'lineRevealParts', 'COURSE_LINE_REVEAL_MS'):
    if legacy in page:
        raise RuntimeError(f'Legacy line reveal implementation remains: {legacy}')
page_path.write_text(page, encoding='utf-8')

css_path = Path('src/widget-page.css')
css = css_path.read_text(encoding='utf-8')
css = replace_range(
    css,
    '''.course-time-shared-prefix,
.course-time-extension { display: inline-block; transform-origin: left center; }''',
    '.course-line-reveal-copy { will-change: clip-path, opacity, transform; }',
    '''.course-morph-target .course-time.is-shared-time-range {
  display: flex;
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

.course-time-extension.course-draw-reveal { display: inline-flex; }
.course-draw-reveal {
  position: relative;
  display: block;
  overflow: visible;
  white-space: pre;
}
.course-draw-guide {
  position: absolute;
  inset: 58% 0 auto;
  height: 1.5px;
  border-radius: 999px;
  background: linear-gradient(90deg, currentColor, rgba(var(--identity-accent-rgb), .14));
  transform-origin: left center;
  pointer-events: none;
  will-change: transform, opacity;
}
.course-drawn-character {
  position: relative;
  display: inline-grid;
  grid-template-areas: 'glyph';
  white-space: pre;
  vertical-align: baseline;
}
.course-drawn-character-outline,
.course-drawn-character-fill {
  grid-area: glyph;
  display: block;
  white-space: pre;
  will-change: clip-path, opacity, filter, transform;
}
.course-drawn-character-outline {
  color: inherit;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: .55px currentColor;
}
.course-drawn-character-fill { color: inherit; }''',
    'draw reveal styles',
)
if 'course-line-reveal' in css:
    raise RuntimeError('Legacy line reveal CSS remains')
css_path.write_text(css, encoding='utf-8')

check_path = Path('scripts/check-presentation-clock.mjs')
check = check_path.read_text(encoding='utf-8')
replacements = [
    ('assert.match(widgetPageSource, /COURSE_SHARED_TEXT_MOVE_MS = 1120/)', 'assert.match(widgetPageSource, /COURSE_SHARED_TEXT_MOVE_MS = 1680/)'),
    ('assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 1120/)', 'assert.match(widgetPageSource, /COURSE_CARD_FORM_MS = 1880/)'),
    ('assert.match(widgetPageSource, /COURSE_LINE_REVEAL_MS = 820/)', '''assert.match(widgetPageSource, /COURSE_DRAW_CHARACTER_MS = 360/)
assert.match(widgetPageSource, /COURSE_DRAW_STAGGER_MS = 90/)
assert.match(widgetPageSource, /COURSE_DRAW_FILL_DELAY_MS = 150/)
assert.match(widgetPageSource, /COURSE_DRAW_GUIDE_MS = 760/)'''),
    ('assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 90/)', 'assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 120/)'),
    ('assert.match(widgetPageSource, /function prepareLineReveal/)', '''assert.match(widgetPageSource, /function prepareDrawReveal/)
assert.match(widgetPageSource, /function drawRevealAnimations/)'''),
    ('assert.match(widgetPageSource, /lineRevealParts/)', 'assert.match(widgetPageSource, /drawRevealParts/)'),
    ('assert.match(widgetPageSource, /course-line-reveal-stroke/)', '''assert.match(widgetPageSource, /course-draw-guide/)
assert.match(widgetPageSource, /course-drawn-character-outline/)
assert.match(widgetPageSource, /course-drawn-character-fill/)'''),
    ('assert.match(widgetPageSource, /duration: COURSE_LINE_REVEAL_MS/)', '''assert.match(widgetPageSource, /characterIndex \\* COURSE_DRAW_STAGGER_MS/)
assert.match(widgetPageSource, /characterDelay \\+ COURSE_DRAW_FILL_DELAY_MS/)'''),
    ('assert.match(widgetPageSource, /await Promise\\.all\\(\\[[\\s\\S]*sharedMotions\\.map[\\s\\S]*animateElement\\(morph[\\s\\S]*targetTimeExtension[\\s\\S]*lineRevealParts\\.flatMap/)', 'assert.match(widgetPageSource, /await Promise\\.all\\(\\[[\\s\\S]*sharedMotions\\.map[\\s\\S]*animateElement\\(morph[\\s\\S]*drawRevealParts\\.flatMap\\(drawRevealAnimations\\)/)'),
    ('assert.match(widgetPageCss, /\\.course-time-extension/)', '''assert.match(widgetPageCss, /\\.course-time\\.is-shared-time-range/)
assert.match(widgetPageCss, /align-items: baseline/)
assert.match(widgetPageCss, /gap: 0/)
assert.match(widgetPageCss, /\\.course-time-extension/)'''),
    ('assert.match(widgetPageCss, /\\.course-line-reveal-stroke/)', '''assert.match(widgetPageCss, /\\.course-draw-guide/)
assert.match(widgetPageCss, /\\.course-drawn-character-outline/)
assert.match(widgetPageCss, /-webkit-text-fill-color: transparent/)'''),
    ('assert.match(widgetPageCss, /will-change: clip-path, opacity, transform/)', 'assert.match(widgetPageCss, /will-change: clip-path, opacity, filter, transform/)'),
    ("console.log('presentation clock, shared start-time growth, line-reveal final-card handoff, duration formatting, controller, and widget wiring checks passed')", "console.log('presentation clock, baseline-aligned shared time, slow per-character outline drawing, duration formatting, controller, and widget wiring checks passed')"),
]
for before, after in replacements:
    check = replace_once(check, before, after, f'check replacement: {before}')
check = replace_once(
    check,
    "assert.match(widgetPageSource, /targetEndTime \\? `–\\$\\{targetEndTime\\}`/)",
    "assert.match(widgetPageSource, /targetEndTime \\? `–\\$\\{targetEndTime\\}`/)\nassert.match(widgetPageSource, /targetTimeCopy\\.classList\\.add\\('is-shared-time-range'\\)/)",
    'shared time alignment check',
)
check = replace_once(
    check,
    "assert.match(widgetPageSource, /clipPath: 'inset\\(0 100% 0 0\\)'/)",
    "assert.match(widgetPageSource, /Array\\.from\\(text\\)\\.map/)\nassert.match(widgetPageSource, /clipPath: 'inset\\(0 100% 0 0\\)'/)\nassert.doesNotMatch(widgetPageSource, /prepareLineReveal|lineRevealParts|COURSE_LINE_REVEAL_MS/)",
    'per-character checks',
)
check_path.write_text(check, encoding='utf-8')

print('Applied baseline-aligned shared time and slow per-character outline drawing.')
