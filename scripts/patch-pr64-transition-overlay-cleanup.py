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
    '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHELL_FORM_DELAY_MS = 360
const COURSE_SHELL_FORM_MS = 1100
const COURSE_SHARED_REFLOW_MS = 2800
const COURSE_FINAL_WIPE_MS = 660
const COURSE_FINAL_REVEAL_MS = 480
const COURSE_TEXT_HANDOFF_MS = 460
const COURSE_RESIZE_MS = 2800''',
    '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHARED_MOVE_MS = 2500
const COURSE_SHELL_REVEAL_DELAY_MS = 1050
const COURSE_SHELL_REVEAL_MS = 1050
const COURSE_FINAL_WIPE_MS = 640
const COURSE_FINAL_REVEAL_MS = 420
const COURSE_TEXT_HANDOFF_MS = 420
const COURSE_RESIZE_MS = 2500''',
    'transition timing constants',
)

helper_start = page.index('function sharedTextMotion(')
helper_end = page.index('function elementText(', helper_start)
new_helpers = '''type SharedTextMotion = {
  element: HTMLElement
  source: HTMLElement
  keyframes: Keyframe[]
}

function removeCourseTransitionOverlay() {
  document.querySelector<HTMLElement>('.course-transition-overlay')?.remove()
  document.querySelectorAll<HTMLElement>('[data-shared-source-hidden="true"]').forEach((source) => {
    source.style.removeProperty('visibility')
    delete source.dataset.sharedSourceHidden
  })
}

function createCourseTransitionOverlay() {
  removeCourseTransitionOverlay()
  const overlay = document.createElement('div')
  overlay.className = 'course-transition-overlay'
  document.body.append(overlay)
  return overlay
}

function sharedTextMotion(
  source: HTMLElement | null,
  target: HTMLElement | null,
  overlay: HTMLElement,
): SharedTextMotion | null {
  if (!source || !target) return null
  const sourceRect = source.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const sourceStyle = getComputedStyle(source)
  const targetStyle = getComputedStyle(target)
  const sourceSize = Number.parseFloat(sourceStyle.fontSize) || 1
  const targetSize = Number.parseFloat(targetStyle.fontSize) || sourceSize
  const scale = targetSize / sourceSize
  const deltaX = targetRect.left - sourceRect.left
  const deltaY = targetRect.top - sourceRect.top
  const floating = source.cloneNode(true) as HTMLElement
  floating.removeAttribute('id')
  floating.classList.add('course-shared-float')
  Object.assign(floating.style, {
    left: `${sourceRect.left}px`,
    top: `${sourceRect.top}px`,
    color: sourceStyle.color,
    fontFamily: sourceStyle.fontFamily,
    fontSize: sourceStyle.fontSize,
    fontStyle: sourceStyle.fontStyle,
    fontWeight: sourceStyle.fontWeight,
    lineHeight: sourceStyle.lineHeight,
    letterSpacing: sourceStyle.letterSpacing,
  })
  source.dataset.sharedSourceHidden = 'true'
  source.style.visibility = 'hidden'
  overlay.append(floating)
  return {
    element: floating,
    source,
    keyframes: [
      { opacity: 1, color: sourceStyle.color, transform: 'translate3d(0, 0, 0) scale(1)' },
      {
        offset: .22,
        opacity: 1,
        color: sourceStyle.color,
        transform: `translate3d(${deltaX * .12}px, ${deltaY * .12}px, 0) scale(${1 + (scale - 1) * .14})`,
      },
      {
        offset: .52,
        opacity: 1,
        color: targetStyle.color,
        transform: `translate3d(${deltaX * .5}px, ${deltaY * .5}px, 0) scale(${1 + (scale - 1) * .52})`,
      },
      {
        offset: .82,
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX * .86}px, ${deltaY * .86}px, 0) scale(${1 + (scale - 1) * .87})`,
      },
      {
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`,
      },
    ] satisfies Keyframe[],
  }
}

'''
page = page[:helper_start] + new_helpers + page[helper_end:]

page = replace_once(
    page,
    "  body.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source, .course-shared-text').forEach((item) => {\n    item.classList.remove('is-promoting-course', 'is-promoting-source', 'course-shared-text')\n  })",
    "  body.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source').forEach((item) => {\n    item.classList.remove('is-promoting-course', 'is-promoting-source')\n  })",
    'handoff body cleanup',
)

page = replace_once(
    page,
    "function collapseHandoffStage() {\n  const stage = app.querySelector<HTMLElement>('.widget-body-handoff')",
    "function collapseHandoffStage() {\n  removeCourseTransitionOverlay()\n  const stage = app.querySelector<HTMLElement>('.widget-body-handoff')",
    'transition overlay abort cleanup',
)

branch_start_marker = "  if (sharedSource && targetPrimary?.classList.contains('focus-course')) {"
branch_end_marker = "  } else {"
branch_start = page.index(branch_start_marker)
branch_end = page.index(branch_end_marker, branch_start)
shared_branch = '''  if (sharedSource && targetPrimary?.classList.contains('focus-course')) {
    const following = transitionSecondary(currentBody)
    following?.classList.add('is-promoting-course')
    sharedSource.classList.add('is-promoting-source')

    await animateElement(outgoingPrimary, [
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
      { offset: .48, opacity: .84, transform: 'translateY(-13px) scale(.993)', filter: 'blur(.8px)' },
      { opacity: 0, transform: 'translateY(-54px) scale(.968)', filter: 'blur(5px)' },
    ], { duration: COURSE_EXIT_MS, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' })
    if (token !== transitionToken) return

    await transitionDelay(COURSE_EXIT_GAP_MS)
    if (token !== transitionToken) return

    const sourceTitle = sharedSource.querySelector<HTMLElement>('strong')
    const sourceLocation = sharedSource.querySelector<HTMLElement>('small')
    const sourceTime = sharedSource.querySelector<HTMLElement>('time')
    const stageRect = stage.getBoundingClientRect()
    const targetRect = targetPrimary.getBoundingClientRect()
    const targetStyle = getComputedStyle(targetPrimary)
    const targetBodyHeight = nextBody.getBoundingClientRect().height
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
    surface.style.clipPath = `inset(0 48% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})`

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

    const stateElement = targetLayer.querySelector<HTMLElement>('.focus-kicker')
    const countdownElement = targetLayer.querySelector<HTMLElement>('.countdown')
    const supportingParts = Array.from(targetLayer.querySelectorAll<HTMLElement>('.course-date, .course-flow'))
    const finalRevealParts = [stateElement, targetTimeExtension, countdownElement, ...supportingParts]
      .filter((part): part is HTMLElement => Boolean(part))
    finalRevealParts.forEach((part) => {
      part.style.opacity = '0'
      part.style.clipPath = 'inset(0 100% 0 0)'
      part.style.transform = 'translateY(3px)'
    })

    morph.append(surface, targetLayer)
    stage.append(morph)
    await nextAnimationFrame()
    if (token !== transitionToken) return

    const overlay = createCourseTransitionOverlay()
    const titleMotion = sharedTextMotion(sourceTitle, targetTitleCopy, overlay)
    const locationMotion = sharedTextMotion(sourceLocation, targetLocationCopy, overlay)
    const timeMotion = sharedTextMotion(sourceTime, targetTimePrefix, overlay)
    const sharedMotions = [titleMotion, locationMotion, timeMotion]
      .filter((motion): motion is SharedTextMotion => Boolean(motion))

    const wipe = document.createElement('div')
    wipe.className = 'course-final-wipe'
    Object.assign(wipe.style, {
      left: `${targetRect.left}px`,
      top: `${targetRect.top}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
      opacity: '0',
    })
    overlay.append(wipe)

    stage.classList.add('is-live-resizing')
    await Promise.all([
      ...sharedMotions.map((motion) => animateElement(motion.element, motion.keyframes, {
        duration: COURSE_SHARED_MOVE_MS,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',
      })),
      animateElement(stage, [
        { height: `${currentHeight}px` },
        { offset: .18, height: `${currentHeight}px` },
        { height: `${targetBodyHeight}px` },
      ], {
        duration: COURSE_RESIZE_MS,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',
      }),
      (async () => {
        await transitionDelay(COURSE_SHELL_REVEAL_DELAY_MS)
        await animateElement(surface, [
          { opacity: 0, clipPath: `inset(0 48% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
          { offset: .36, opacity: .24, clipPath: `inset(0 28% ${compactBottomInset * .7}% 0 round ${targetStyle.borderRadius})` },
          { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
        ], {
          duration: COURSE_SHELL_REVEAL_MS,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
          fill: 'both',
        })
      })(),
    ])
    if (token !== transitionToken) return
    resizedDuringSharedHandoff = true

    targetCopies.forEach((copy) => {
      copy.classList.remove('is-shared-copy-hidden')
      copy.style.opacity = '0'
    })

    await Promise.all([
      animateElement(wipe, [
        { opacity: 0, transform: 'translate3d(0, 0, 0) skewX(-12deg)' },
        { offset: .1, opacity: .92, transform: 'translate3d(18%, 0, 0) skewX(-12deg)' },
        { offset: .78, opacity: .9, transform: 'translate3d(250%, 0, 0) skewX(-12deg)' },
        { opacity: 0, transform: 'translate3d(286%, 0, 0) skewX(-12deg)' },
      ], {
        duration: COURSE_FINAL_WIPE_MS,
        easing: 'cubic-bezier(.4, 0, .2, 1)',
        fill: 'both',
      }),
      ...sharedMotions.map((motion) => animateElement(motion.element, [
        { opacity: 1 },
        { offset: .52, opacity: .96 },
        { opacity: 0 },
      ], {
        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 92,
        easing: 'cubic-bezier(.4, 0, .7, .2)',
        fill: 'both',
      })),
      ...targetCopies.map((copy) => animateElement(copy, [
        { opacity: 0 },
        { offset: .24, opacity: .12 },
        { opacity: 1 },
      ], {
        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 112,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      })),
      ...finalRevealParts.map((part, index) => animateElement(part, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: 'translateY(3px)' },
        { offset: .22, opacity: .16, clipPath: 'inset(0 76% 0 0)', transform: 'translateY(2px)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' },
      ], {
        duration: COURSE_FINAL_REVEAL_MS,
        delay: 52 + index * 12,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      })),
    ])
    if (token !== transitionToken) return

    removeCourseTransitionOverlay()
    targetCopies.forEach((copy) => {
      clearElementAnimations(copy)
      copy.style.removeProperty('opacity')
    })
    finalRevealParts.forEach((part) => {
      clearElementAnimations(part)
      part.style.removeProperty('opacity')
      part.style.removeProperty('clip-path')
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
page = page[:branch_start] + shared_branch + page[branch_end:]

page_path.write_text(page, encoding='utf-8')

css_path = Path('src/widget-page.css')
css = css_path.read_text(encoding='utf-8')

css = replace_once(
    css,
    '''.course-shared-morph {
  position: absolute;
  z-index: 3;
  overflow: hidden;
  box-sizing: border-box;
  pointer-events: none;
  transform-origin: top left;
  will-change: height, opacity;
}''',
    '''.course-shared-morph {
  position: absolute;
  z-index: 3;
  overflow: hidden;
  box-sizing: border-box;
  pointer-events: none;
  transform-origin: top left;
  will-change: opacity;
}''',
    'shared morph container styles',
)

css = replace_once(
    css,
    '''.course-morph-target {
  z-index: 2;
  width: 100%;
  height: 100%;
  background: transparent !important;
  box-shadow: none !important;
}''',
    '''.course-morph-target {
  z-index: 2;
  width: 100%;
  height: 100%;
  border-color: transparent !important;
  outline: none !important;
  background: transparent !important;
  box-shadow: none !important;
}''',
    'target card shell suppression',
)

old_source_styles = '''.is-promoting-source strong,
.is-promoting-source small,
.is-promoting-source > time {
  position: relative;
  z-index: 7;
  display: block;
  width: max-content;
  max-width: none;
  white-space: nowrap;
  transform-origin: top left;
  will-change: transform, color, opacity;
}

'''
if old_source_styles in css:
    css = css.replace(old_source_styles, '', 1)

insert_anchor = '.widget-body-handoff.is-live-resizing { will-change: height; }\n\n'
overlay_styles = '''.widget-body-handoff.is-live-resizing { will-change: height; }

.course-transition-overlay {
  position: fixed;
  z-index: 2147483000;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.course-shared-float {
  position: absolute;
  z-index: 1;
  display: block;
  width: max-content;
  max-width: none;
  margin: 0;
  padding: 0;
  white-space: nowrap;
  transform-origin: top left;
  will-change: transform, color, opacity;
}

'''
css = replace_once(css, insert_anchor, overlay_styles, 'transition overlay styles')

css = replace_once(
    css,
    '''.course-final-wipe {
  position: absolute;
  z-index: 8;
  top: -12%;
  bottom: -12%;
  left: -58%;
  width: 58%;''',
    '''.course-final-wipe {
  position: absolute;
  z-index: 2;
  overflow: hidden;
  border-radius: 18px;

  &::before {
    position: absolute;
    inset: -12% auto -12% -58%;
    width: 58%;
    content: '';
  }

  &::before {''',
    'wipe overlay wrapper',
)

css = replace_once(
    css,
    '''  filter: blur(.6px);
  mix-blend-mode: screen;
  pointer-events: none;
  transform-origin: center;
  will-change: transform, opacity;
}''',
    '''    filter: blur(.6px);
    mix-blend-mode: screen;
    pointer-events: none;
    transform-origin: center;
  }

  pointer-events: none;
  transform-origin: center;
  will-change: transform, opacity;
}''',
    'wipe overlay closing styles',
)

css_path.write_text(css, encoding='utf-8')

check_path = Path('scripts/check-presentation-clock.mjs')
check = check_path.read_text(encoding='utf-8')

start = check.index("assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)")
end = check.index("assert.match(widgetPageSource, /function courseIdentityKey/)", start)
check = check[:start] + '''assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHARED_MOVE_MS = 2500/)
assert.match(widgetPageSource, /COURSE_SHELL_REVEAL_DELAY_MS = 1050/)
assert.match(widgetPageSource, /COURSE_SHELL_REVEAL_MS = 1050/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 640/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 420/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 420/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2500/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHELL_FORM|COURSE_SHARED_REFLOW|is-shared-reflowing/)
''' + check[end:]

start = check.index("assert.match(widgetPageSource, /function findSharedCourseSource/)")
end = check.index("assert.match(widgetPageSource, /if \\(!currentWidget\\)/)", start)
check = check[:start] + '''assert.match(widgetPageSource, /function findSharedCourseSource/)
assert.match(widgetPageSource, /function createCourseTransitionOverlay/)
assert.match(widgetPageSource, /function removeCourseTransitionOverlay/)
assert.match(widgetPageSource, /document\\.body\\.append\\(overlay\\)/)
assert.match(widgetPageSource, /type SharedTextMotion/)
assert.match(widgetPageSource, /source\\.dataset\\.sharedSourceHidden = 'true'/)
assert.match(widgetPageSource, /source\\.style\\.visibility = 'hidden'/)
assert.match(widgetPageSource, /overlay\\.append\\(floating\\)/)
assert.match(widgetPageSource, /sharedTextMotion\\(sourceTitle, targetTitleCopy, overlay\\)/)
assert.match(widgetPageSource, /sharedTextMotion\\(sourceLocation, targetLocationCopy, overlay\\)/)
assert.match(widgetPageSource, /sharedTextMotion\\(sourceTime, targetTimePrefix, overlay\\)/)
assert.match(widgetPageSource, /COURSE_SHELL_REVEAL_DELAY_MS/)
assert.match(widgetPageSource, /duration: COURSE_SHARED_MOVE_MS/)
assert.match(widgetPageSource, /offset: \\.18, height: `\\$\\{currentHeight\\}px`/)
assert.match(widgetPageSource, /wipe\\.className = 'course-final-wipe'/)
assert.match(widgetPageSource, /overlay\\.append\\(wipe\\)/)
assert.match(widgetPageSource, /delay: 52 \\+ index \\* 12/)
assert.match(widgetPageSource, /removeCourseTransitionOverlay\\(\\)/)
assert.doesNotMatch(widgetPageSource, /currentWidget\\.classList\\.add\\('is-shared-reflowing'\\)/)
assert.doesNotMatch(widgetPageSource, /sourceLayer|is-shared-course-source|course-shared-text/)
assert.match(widgetPageSource, /targetPrimary\\.replaceWith\\(targetLayer\\)/)
assert.match(widgetPageSource, /stage\\.replaceChildren\\(nextBody\\)/)
assert.match(widgetPageSource, /stage\\.replaceWith\\(nextBody\\)/)
''' + check[end:]

css_start = check.index("assert.match(widgetPageCss, /\\.course-shared-morph/)")
css_end = check.index("assert.match(widgetPageCss, /visibility: hidden/)", css_start)
check = check[:css_start] + '''assert.match(widgetPageCss, /\\.course-shared-morph/)
assert.match(widgetPageCss, /\\.course-morph-target/)
assert.match(widgetPageCss, /border-color: transparent !important/)
assert.match(widgetPageCss, /\\.course-transition-overlay/)
assert.match(widgetPageCss, /position: fixed/)
assert.match(widgetPageCss, /z-index: 2147483000/)
assert.match(widgetPageCss, /\\.course-shared-float/)
assert.match(widgetPageCss, /\\.course-final-wipe/)
assert.match(widgetPageCss, /mix-blend-mode: screen/)
assert.doesNotMatch(widgetPageCss, /is-shared-reflowing/)
''' + check[css_end:]

check = check.replace(
    'presentation clock, exact shared-time alignment, synchronized shared-text reflow and window resizing, final-card wipe reveal, duration formatting, controller, and widget wiring checks passed',
    'presentation clock, unclipped overlay shared-text handoff, synchronized resizing, immediate wipe reveal, duration formatting, controller, and widget wiring checks passed',
)
check_path.write_text(check, encoding='utf-8')
