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
const COURSE_SHARED_CLUSTER_MS = 3200
const COURSE_CARD_FORM_MS = 1800
const COURSE_TIME_EXTENSION_MS = 1400
const COURSE_STATE_REVEAL_MS = 900
const COURSE_STATE_REVEAL_GAP_MS = 240
const COURSE_COUNTDOWN_REVEAL_MS = 1200
const COURSE_TEXT_HANDOFF_MS = 520
const COURSE_RESIZE_MS = 1000''',
    '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHELL_PREP_MS = 820
const COURSE_SHARED_REFLOW_MS = 2600
const COURSE_FINAL_WIPE_MS = 760
const COURSE_FINAL_REVEAL_MS = 620
const COURSE_TEXT_HANDOFF_MS = 520
const COURSE_RESIZE_MS = 2600''',
    'handoff timing constants',
)

helper_start = page.index('function prepareSweepReveal(')
helper_end = page.index('function elementText(', helper_start)
page = page[:helper_start] + page[helper_end:]

page = replace_once(
    page,
    "  const sharedSource = findSharedCourseSource(currentBody, nextBody)\n",
    "  const sharedSource = findSharedCourseSource(currentBody, nextBody)\n  let resizedDuringSharedHandoff = false\n",
    'shared resize state',
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

    const stateElement = targetLayer.querySelector<HTMLElement>('.focus-kicker')
    const countdownElement = targetLayer.querySelector<HTMLElement>('.countdown')
    const supportingParts = Array.from(targetLayer.querySelectorAll<HTMLElement>('.course-date, .course-flow'))
    const finalRevealParts = [stateElement, targetTimeExtension, countdownElement, ...supportingParts]
      .filter((part): part is HTMLElement => Boolean(part))
    finalRevealParts.forEach((part) => {
      part.style.opacity = '0'
      part.style.clipPath = 'inset(0 100% 0 0)'
      part.style.transform = 'translateY(4px)'
    })

    const wipe = document.createElement('div')
    wipe.className = 'course-final-wipe'
    wipe.style.opacity = '0'
    morph.append(surface, targetLayer, wipe)
    stage.append(morph)
    await nextAnimationFrame()
    if (token !== transitionToken) return

    const titleMotion = sharedTextMotion(sourceTitle, targetTitleCopy)
    const locationMotion = sharedTextMotion(sourceLocation, targetLocationCopy)
    const timeMotion = sharedTextMotion(sourceTime, targetTimePrefix)
    const sharedMotions = [titleMotion, locationMotion, timeMotion]
      .filter((motion): motion is NonNullable<typeof motion> => Boolean(motion))

    await animateElement(surface, [
      { opacity: 0, clipPath: `inset(0 46% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
      { offset: .36, opacity: .18, clipPath: `inset(0 28% ${compactBottomInset * .66}% 0 round ${targetStyle.borderRadius})` },
      { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
    ], {
      duration: COURSE_SHELL_PREP_MS,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    })
    if (token !== transitionToken) return

    stage.classList.add('is-live-resizing')
    await Promise.all([
      ...sharedMotions.map((motion) => animateElement(
        motion.element,
        motion.keyframes,
        {
          duration: COURSE_SHARED_REFLOW_MS,
          easing: 'cubic-bezier(.2, .62, .18, 1)',
          fill: 'both',
        },
      )),
      animateElement(stage, [
        { height: `${currentHeight}px` },
        { height: `${targetBodyHeight}px` },
      ], {
        duration: COURSE_RESIZE_MS,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',
      }),
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
        { offset: .12, opacity: .92, transform: 'translate3d(18%, 0, 0) skewX(-12deg)' },
        { offset: .78, opacity: .88, transform: 'translate3d(252%, 0, 0) skewX(-12deg)' },
        { opacity: 0, transform: 'translate3d(286%, 0, 0) skewX(-12deg)' },
      ], {
        duration: COURSE_FINAL_WIPE_MS,
        easing: 'cubic-bezier(.4, 0, .2, 1)',
        fill: 'both',
      }),
      ...sharedMotions.map((motion) => animateElement(motion.element, [
        { opacity: 1 },
        { offset: .46, opacity: .94 },
        { opacity: 0 },
      ], {
        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 170,
        easing: 'cubic-bezier(.4, 0, .7, .2)',
        fill: 'both',
      })),
      ...targetCopies.map((copy) => animateElement(copy, [
        { opacity: 0 },
        { offset: .34, opacity: .08 },
        { opacity: 1 },
      ], {
        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 190,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      })),
      ...finalRevealParts.map((part, index) => animateElement(part, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: 'translateY(4px)' },
        { offset: .28, opacity: .12, clipPath: 'inset(0 82% 0 0)', transform: 'translateY(3px)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' },
      ], {
        duration: COURSE_FINAL_REVEAL_MS,
        delay: 270 + index * 46,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      })),
    ])
    if (token !== transitionToken) return

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

common_start = page.index('  resetHandoffBody(nextBody)', branch_start)
common_end = page.index('  finishCourseTransition(token, resumeAfterTransition)', common_start)
common_block = '''  const nextFollowing = transitionSecondary(nextBody)
  if (resizedDuringSharedHandoff && nextFollowing) {
    nextFollowing.style.opacity = '0'
    nextFollowing.style.transform = 'translateY(10px)'
  }

  resetHandoffBody(nextBody)
  stage.replaceChildren(nextBody)
  stage.classList.add('is-size-settling')
  const targetHeight = nextBody.getBoundingClientRect().height

  if (!sharedSource || !targetPrimary?.classList.contains('focus-course')) {
    const incomingPrimary = transitionPrimary(nextBody)
    await animateElement(incomingPrimary, [
      { opacity: 0, transform: 'translateY(34px) scale(.96)', filter: 'blur(5px)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
    ], { duration: 1500, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' })
    if (token !== transitionToken) return
  }

  if (resizedDuringSharedHandoff) {
    stage.style.height = `${targetHeight}px`
    clearElementAnimations(stage)
    stage.classList.remove('is-live-resizing')
    await nextAnimationFrame()
    if (nextFollowing) {
      await animateElement(nextFollowing, [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], {
        duration: 560,
        delay: 80,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      })
      clearElementAnimations(nextFollowing)
      nextFollowing.style.removeProperty('opacity')
      nextFollowing.style.removeProperty('transform')
    }
  } else {
    await Promise.all([
      animateElement(stage, [
        { height: `${currentHeight}px` },
        { height: `${targetHeight}px` },
      ], {
        duration: COURSE_RESIZE_MS,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      }),
      animateElement(nextFollowing, [
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], {
        duration: 720,
        delay: 140,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      }),
    ])
    if (token !== transitionToken) return
  }

  stage.style.removeProperty('height')
  stage.replaceWith(nextBody)
'''
page = page[:common_start] + common_block + page[common_end:]
page_path.write_text(page, encoding='utf-8')

css_path = Path('src/widget-page.css')
css = css_path.read_text(encoding='utf-8')
css = replace_once(
    css,
    '''.course-time-extension.course-sweep-reveal { display: inline-flex; }
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
''',
    '''.widget-body-handoff.is-live-resizing { will-change: height; }

.course-final-wipe {
  position: absolute;
  z-index: 8;
  top: -12%;
  bottom: -12%;
  left: -58%;
  width: 58%;
  border-radius: 42%;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, .16) 22%,
    rgba(255, 255, 255, .78) 49%,
    rgba(var(--identity-accent-rgb), .24) 61%,
    rgba(255, 255, 255, 0)
  );
  filter: blur(.6px);
  mix-blend-mode: screen;
  pointer-events: none;
  transform-origin: center;
  will-change: transform, opacity;
}
''',
    'sweep styles',
)
css_path.write_text(css, encoding='utf-8')

check_path = Path('scripts/check-presentation-clock.mjs')
check = check_path.read_text(encoding='utf-8')
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /function sharedTextMotion/)
assert.match(widgetPageSource, /function prepareSweepReveal/)
assert.match(widgetPageSource, /function sweepRevealAnimations/)
assert.match(widgetPageSource, /source\.classList\.add\('course-shared-text'\)/)
assert.match(widgetPageSource, /function clearElementAnimations/)
assert.match(widgetPageSource, /following\?\.classList\.add\('is-promoting-course'\)/)
assert.match(widgetPageSource, /sharedSource\.classList\.add\('is-promoting-source'\)/)
assert.match(widgetPageSource, /const sourceTitle = sharedSource\.querySelector<HTMLElement>\('strong'\)/)
assert.match(widgetPageSource, /const sourceLocation = sharedSource\.querySelector<HTMLElement>\('small'\)/)
assert.match(widgetPageSource, /const sourceTime = sharedSource\.querySelector<HTMLElement>\('time'\)/)
assert.match(widgetPageSource, /const targetTitleCopy = targetLayer\.querySelector<HTMLElement>\('h2'\)/)
assert.match(widgetPageSource, /const targetLocationCopy = targetLayer\.querySelector<HTMLElement>\('\.course-location'\)/)
assert.match(widgetPageSource, /const targetTimeCopy = targetLayer\.querySelector<HTMLElement>\('\.course-time'\)/)
assert.match(widgetPageSource, /const timeMotion = sharedTextMotion\(sourceTime, targetTimePrefix\)/)
assert.match(widgetPageSource, /course-time-shared-prefix/)
assert.match(widgetPageSource, /course-time-extension/)
assert.match(widgetPageSource, /targetEndTime \? `–\$\{targetEndTime\}`/)
assert.match(widgetPageSource, /targetTimeCopy\.classList\.add\('is-shared-time-range'\)/)
assert.match(widgetPageSource, /const timeSweep = targetTimeExtension \? prepareSweepReveal/)
assert.match(widgetPageSource, /const stateSweep = stateElement \? prepareSweepReveal/)
assert.match(widgetPageSource, /const countdownSweep = countdownElement \? prepareSweepReveal/)
assert.match(widgetPageSource, /course-sweep-copy/)
assert.match(widgetPageSource, /course-sweep-edge/)
assert.match(widgetPageSource, /clipPath: 'inset\(0 100% 0 0\)'/)
assert.doesNotMatch(widgetPageSource, /prepareDrawReveal|drawRevealAnimations|COURSE_DRAW_/)
assert.match(widgetPageSource, /await Promise\.all\(\[[\s\S]*sharedMotions\.map[\s\S]*animateElement\(surface[\s\S]*timeSweep/)
assert.match(widgetPageSource, /duration: COURSE_SHARED_CLUSTER_MS/)
assert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS \* \.58/)
assert.match(widgetPageSource, /COURSE_SHARED_CLUSTER_MS \* \.72/)
assert.match(widgetPageSource, /offset: \.76[\s\S]*deltaX \* \.8/)
assert.match(widgetPageSource, /delay: 0[\s\S]*cubic-bezier\(\.2, \.62, \.18, 1\)/)
assert.match(widgetPageSource, /duration: COURSE_CARD_FORM_MS/)
assert.match(widgetPageSource, /await transitionDelay\(COURSE_STATE_REVEAL_GAP_MS\)/)
assert.match(widgetPageSource, /COURSE_COUNTDOWN_REVEAL_MS/)
assert.match(widgetPageSource, /duration: COURSE_TEXT_HANDOFF_MS/)
assert.match(widgetPageSource, /targetPrimary\.replaceWith\(targetLayer\)/)
assert.match(widgetPageSource, /targetLayer\.classList\.remove\('course-morph-target'\)/)
assert.match(widgetPageSource, /morph\.remove\(\)/)
assert.doesNotMatch(widgetPageSource, /sourceLayer/)
assert.doesNotMatch(widgetPageSource, /is-shared-course-source/)
assert.doesNotMatch(widgetPageSource, /targetInsetX|targetInsetY/)
assert.match(widgetPageSource, /translate3d\(\$\{deltaX\}px, \$\{deltaY\}px, 0\)/)
assert.match(widgetPageSource, /stage\.replaceChildren\(nextBody\)/)
assert.match(widgetPageSource, /stage\.classList\.add\('is-size-settling'\)/)
assert.match(widgetPageSource, /height: `\$\{targetHeight\}px`/)
assert.match(widgetPageSource, /stage\.replaceWith\(nextBody\)/)''',
    '''assert.match(widgetPageSource, /function sharedTextMotion/)
assert.doesNotMatch(widgetPageSource, /function prepareSweepReveal|function sweepRevealAnimations/)
assert.match(widgetPageSource, /source\.classList\.add\('course-shared-text'\)/)
assert.match(widgetPageSource, /function clearElementAnimations/)
assert.match(widgetPageSource, /following\?\.classList\.add\('is-promoting-course'\)/)
assert.match(widgetPageSource, /sharedSource\.classList\.add\('is-promoting-source'\)/)
assert.match(widgetPageSource, /const sourceTitle = sharedSource\.querySelector<HTMLElement>\('strong'\)/)
assert.match(widgetPageSource, /const sourceLocation = sharedSource\.querySelector<HTMLElement>\('small'\)/)
assert.match(widgetPageSource, /const sourceTime = sharedSource\.querySelector<HTMLElement>\('time'\)/)
assert.match(widgetPageSource, /const targetTitleCopy = targetLayer\.querySelector<HTMLElement>\('h2'\)/)
assert.match(widgetPageSource, /const targetLocationCopy = targetLayer\.querySelector<HTMLElement>\('\.course-location'\)/)
assert.match(widgetPageSource, /const targetTimeCopy = targetLayer\.querySelector<HTMLElement>\('\.course-time'\)/)
assert.match(widgetPageSource, /const timeMotion = sharedTextMotion\(sourceTime, targetTimePrefix\)/)
assert.match(widgetPageSource, /course-time-shared-prefix/)
assert.match(widgetPageSource, /course-time-extension/)
assert.match(widgetPageSource, /targetEndTime \? `–\$\{targetEndTime\}`/)
assert.match(widgetPageSource, /targetTimeCopy\.classList\.add\('is-shared-time-range'\)/)
assert.match(widgetPageSource, /COURSE_SHELL_PREP_MS = 820/)
assert.match(widgetPageSource, /COURSE_SHARED_REFLOW_MS = 2600/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 760/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 620/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2600/)
assert.match(widgetPageSource, /const wipe = document\.createElement\('div'\)/)
assert.match(widgetPageSource, /wipe\.className = 'course-final-wipe'/)
assert.match(widgetPageSource, /stage\.classList\.add\('is-live-resizing'\)/)
assert.match(widgetPageSource, /await Promise\.all\(\[[\s\S]*sharedMotions\.map[\s\S]*animateElement\(stage/)
assert.match(widgetPageSource, /duration: COURSE_SHARED_REFLOW_MS/)
assert.match(widgetPageSource, /duration: COURSE_RESIZE_MS/)
assert.match(widgetPageSource, /translate3d\(252%, 0, 0\)/)
assert.match(widgetPageSource, /finalRevealParts\.map/)
assert.match(widgetPageSource, /clipPath: 'inset\(0 100% 0 0\)'/)
assert.match(widgetPageSource, /duration: COURSE_TEXT_HANDOFF_MS/)
assert.match(widgetPageSource, /targetPrimary\.replaceWith\(targetLayer\)/)
assert.match(widgetPageSource, /targetLayer\.classList\.remove\('course-morph-target'\)/)
assert.match(widgetPageSource, /morph\.remove\(\)/)
assert.match(widgetPageSource, /let resizedDuringSharedHandoff = false/)
assert.match(widgetPageSource, /resizedDuringSharedHandoff = true/)
assert.match(widgetPageSource, /stage\.style\.height = `\$\{targetHeight\}px`/)
assert.match(widgetPageSource, /clearElementAnimations\(stage\)/)
assert.doesNotMatch(widgetPageSource, /sourceLayer|is-shared-course-source|targetInsetX|targetInsetY/)
assert.match(widgetPageSource, /translate3d\(\$\{deltaX\}px, \$\{deltaY\}px, 0\)/)
assert.match(widgetPageSource, /stage\.replaceChildren\(nextBody\)/)
assert.match(widgetPageSource, /stage\.classList\.add\('is-size-settling'\)/)
assert.match(widgetPageSource, /stage\.replaceWith\(nextBody\)/)''',
    'handoff assertions',
)
check = replace_once(
    check,
    '''assert.match(widgetPageCss, /\.course-time-extension/)
assert.match(widgetPageCss, /\.course-sweep-reveal/)
assert.match(widgetPageCss, /\.course-sweep-copy/)
assert.match(widgetPageCss, /\.course-sweep-edge/)
assert.match(widgetPageCss, /width: max-content/)''',
    '''assert.match(widgetPageCss, /\.course-time-extension/)
assert.match(widgetPageCss, /\.widget-body-handoff\.is-live-resizing/)
assert.match(widgetPageCss, /\.course-final-wipe/)
assert.match(widgetPageCss, /mix-blend-mode: screen/)
assert.match(widgetPageCss, /will-change: transform, opacity/)''',
    'wipe css assertions',
)
check = check.replace(
    'exact shared-time alignment, visibly paced shared-cluster promotion, delayed shell formation, sweep reveals',
    'exact shared-time alignment, synchronized shared-text reflow and window resizing, final-card wipe reveal',
)
check_path.write_text(check, encoding='utf-8')
