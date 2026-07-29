import './style.css'
import './widget-page.css'
import './time-flow.css'
import { isTauri } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  PRESENTATION_COMMAND_EVENT,
  PRESENTATION_STATUS_EVENT,
  PRESENTATION_STATUS_REQUEST_EVENT,
  type PresentationCommand,
  type PresentationStatus,
} from './presentation-events'
import { PresentationClock, type ReplayConfig, type ReplaySnapshot } from './presentation-clock'
import { enhanceTimeFlow } from './time-flow'
import { clearActiveSchedule, createWidget, defaultOptions, setActiveSchedule, type ScheduleSource, type WidgetOptions } from './widget'

const app = document.querySelector<HTMLDivElement>('#app')!
const scenarioByQuery: Record<string, WidgetOptions['scenario']> = {
  current: 'current',
  between: 'between',
  finished: 'ended',
  'no-course': 'empty',
  'before-semester': 'before',
  browsing: 'browsing',
}
const desktopRuntime = isTauri()
const query = new URLSearchParams(window.location.search)
const debugLiveRuntime = import.meta.env.DEV && !desktopRuntime && query.get('runtime') === 'live'
const requestedScenario = import.meta.env.DEV && !desktopRuntime && !debugLiveRuntime
  ? query.get('scenario')
  : null
const options: WidgetOptions = {
  ...defaultOptions,
  runtime: desktopRuntime || debugLiveRuntime ? 'live' : 'prototype',
  scenario: requestedScenario ? scenarioByQuery[requestedScenario] ?? defaultOptions.scenario : defaultOptions.scenario,
  dragRegion: true,
  closeControl: desktopRuntime,
}

const COURSE_EXIT_MS = 720
const COURSE_EXIT_GAP_MS = 120
const COURSE_SHARED_CLUSTER_MS = 980
const COURSE_CARD_FORM_MS = 920
const COURSE_TIME_EXTENSION_MS = 760
const COURSE_STATE_REVEAL_MS = 520
const COURSE_STATE_REVEAL_GAP_MS = 160
const COURSE_COUNTDOWN_REVEAL_MS = 680
const COURSE_TEXT_HANDOFF_MS = 140
const COURSE_RESIZE_MS = 1000
const COURSE_TRANSITION_SETTLE_MS = 420
const presentationClock = new PresentationClock()
let presentationFrame: number | undefined
let minuteTimeout: number | undefined
let minuteInterval: number | undefined
let transitionTimer: number | undefined
let transitionToken = 0
let transitionActive = false
let handoffAnimations: Animation[] = []
let lastPresentationMinute = Number.NaN
let lastPublishedPercent = -1
let presentationMessage = '演示只改变课刻画面，不会修改系统时间或课表数据。'
let presentationRestore: Pick<WidgetOptions, 'showNav' | 'closeControl' | 'browseDate'> | null = null

function buildWidget() {
  return enhanceTimeFlow(createWidget(options, renderWidget), options)
}

function courseIdentityKey(widget: HTMLElement | null) {
  if (!widget) return ''
  const focus = widget.querySelector<HTMLElement>('.focus-course')
  if (focus) {
    const course = focus.querySelector<HTMLElement>('h2')?.textContent ?? ''
    const courseTime = focus.querySelector<HTMLElement>('.course-time')?.textContent ?? ''
    const focusDate = focus.querySelector<HTMLElement>('.course-date')?.textContent ?? ''
    return `course|${course}|${courseTime}|${focusDate}`
  }
  const state = widget.querySelector<HTMLElement>('.state-label, .empty-state, .opening-date')?.textContent ?? ''
  return `state|${state}`
}

function syncAttributes(current: Element, next: Element) {
  Array.from(current.attributes).forEach((attribute) => {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name)
  })
  Array.from(next.attributes).forEach((attribute) => {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value)
  })
}

function syncNode(current: Node, next: Node): void {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.parentNode?.replaceChild(next.cloneNode(true), current)
    return
  }

  if (current.nodeType === Node.TEXT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
    return
  }

  if (!(current instanceof Element) || !(next instanceof Element)) return
  syncAttributes(current, next)

  const currentChildren = Array.from(current.childNodes)
  const nextChildren = Array.from(next.childNodes)
  const sharedLength = Math.min(currentChildren.length, nextChildren.length)
  for (let index = 0; index < sharedLength; index += 1) syncNode(currentChildren[index], nextChildren[index])
  for (let index = currentChildren.length - 1; index >= nextChildren.length; index -= 1) {
    currentChildren[index].parentNode?.removeChild(currentChildren[index])
  }
  for (let index = currentChildren.length; index < nextChildren.length; index += 1) {
    current.appendChild(nextChildren[index].cloneNode(true))
  }
}

function syncStableWidget(current: HTMLElement, next: HTMLElement) {
  syncNode(current, next)
}

function transitionPrimary(root: ParentNode | null) {
  return root?.querySelector<HTMLElement>('.focus-course, .state-label, .empty-state, .opening-date') ?? null
}

function transitionSecondary(root: ParentNode | null) {
  return root?.querySelector<HTMLElement>('.following') ?? null
}

function rememberAnimation(animation: Animation) {
  handoffAnimations.push(animation)
  void animation.finished.finally(() => {
    handoffAnimations = handoffAnimations.filter((current) => current !== animation)
  }).catch(() => undefined)
  return animation.finished.catch(() => undefined)
}

function animateElement(
  element: HTMLElement | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  if (!element) return Promise.resolve()
  return rememberAnimation(element.animate(keyframes, options))
}

function clearElementAnimations(element: HTMLElement | null) {
  element?.getAnimations().forEach((animation) => animation.cancel())
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

function transitionDelay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

function sharedTextMotion(source: HTMLElement | null, target: HTMLElement | null) {
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
  source.classList.add('course-shared-text')
  return {
    element: source,
    keyframes: [
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
    ] satisfies Keyframe[],
  }
}

function prepareSweepReveal(element: HTMLElement) {
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

function elementText(root: ParentNode | null, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() ?? ''
}

function findSharedCourseSource(currentBody: HTMLElement, nextBody: HTMLElement) {
  const nextFocus = nextBody.querySelector<HTMLElement>('.focus-course')
  const nextName = elementText(nextFocus, 'h2')
  const nextStart = elementText(nextFocus, '.course-time').split(/[–-]/)[0]?.trim() ?? ''
  if (!nextName || !nextStart) return null

  return Array.from(currentBody.querySelectorAll<HTMLElement>('.following .timeline li')).find((item) => {
    return elementText(item, 'strong') === nextName && elementText(item, 'time') === nextStart
  }) ?? null
}

function resetHandoffBody(body: HTMLElement) {
  body.classList.remove('is-handoff-current', 'is-handoff-target')
  body.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source, .course-shared-text').forEach((item) => {
    item.classList.remove('is-promoting-course', 'is-promoting-source', 'course-shared-text')
  })
}

function collapseHandoffStage() {
  const stage = app.querySelector<HTMLElement>('.widget-body-handoff')
  if (!stage) return
  const target = stage.querySelector<HTMLElement>('.widget-body.is-handoff-target')
  const current = stage.querySelector<HTMLElement>('.widget-body.is-handoff-current')
  const keeper = target ?? current
  stage.querySelector<HTMLElement>('.course-shared-morph')?.remove()
  if (!keeper) {
    stage.remove()
    return
  }
  resetHandoffBody(keeper)
  stage.replaceWith(keeper)
}

function clearCourseTransition() {
  transitionToken += 1
  if (transitionTimer !== undefined) window.clearTimeout(transitionTimer)
  transitionTimer = undefined
  handoffAnimations.forEach((animation) => animation.cancel())
  handoffAnimations = []
  collapseHandoffStage()
  transitionActive = false
  document.documentElement.classList.remove('is-course-transitioning')
}

function presentationPlayingMessage(prefix = '演示播放中') {
  const speed = presentationClock.currentConfig()?.minutesPerSecond
  return speed
    ? `${prefix} · ${speed} 分钟/秒。课程交接时会自动停表。`
    : `${prefix}。课程交接时会自动停表。`
}

function finishCourseTransition(token: number, resumeAfterTransition: boolean) {
  if (token !== transitionToken) return
  transitionTimer = window.setTimeout(() => {
    if (token !== transitionToken) return
    transitionTimer = undefined
    transitionActive = false
    document.documentElement.classList.remove('is-course-transitioning')

    const timestamp = performance.now()
    const current = presentationClock.snapshot(timestamp)
    if (resumeAfterTransition && current.active && !current.finished) {
      const resumed = presentationClock.resume(timestamp)
      presentationMessage = presentationPlayingMessage()
      publishPresentationStatus(resumed, true)
      clearPresentationFrame()
      presentationFrame = window.requestAnimationFrame(presentationTick)
      return
    }

    presentationMessage = current.finished ? '回放完成。' : '演示已暂停。'
    publishPresentationStatus(current, true)
  }, COURSE_TRANSITION_SETTLE_MS)
}

async function runCourseHandoff(
  token: number,
  currentWidget: HTMLElement,
  nextWidget: HTMLElement,
  resumeAfterTransition: boolean,
) {
  const currentBody = currentWidget.querySelector<HTMLElement>('.widget-body')
  const nextBody = nextWidget.querySelector<HTMLElement>('.widget-body')
  if (!currentBody || !nextBody) {
    syncStableWidget(currentWidget, nextWidget)
    finishCourseTransition(token, resumeAfterTransition)
    return
  }

  const currentHeight = currentBody.getBoundingClientRect().height
  const stage = document.createElement('div')
  stage.className = 'widget-body-handoff'
  stage.style.height = `${currentHeight}px`
  currentBody.classList.add('is-handoff-current')
  nextBody.classList.add('is-handoff-target')
  currentBody.replaceWith(stage)
  stage.append(currentBody, nextBody)

  await nextAnimationFrame()
  if (token !== transitionToken) return

  const outgoingPrimary = transitionPrimary(currentBody)
  const outgoingSecondary = transitionSecondary(currentBody)
  const targetPrimary = transitionPrimary(nextBody)
  const sharedSource = findSharedCourseSource(currentBody, nextBody)

  if (sharedSource && targetPrimary?.classList.contains('focus-course')) {
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
  } else {
    await Promise.all([
      animateElement(outgoingPrimary, [
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        { opacity: 0, transform: 'translateY(-46px) scale(.97)', filter: 'blur(5px)' },
      ], { duration: COURSE_EXIT_MS, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' }),
      animateElement(outgoingSecondary, [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-16px)' },
      ], { duration: COURSE_EXIT_MS - 180, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' }),
    ])
    if (token !== transitionToken) return
  }

  const currentHeader = currentWidget.querySelector<HTMLElement>('.widget-header')
  const nextHeader = nextWidget.querySelector<HTMLElement>('.widget-header')
  if (currentHeader && nextHeader) syncNode(currentHeader, nextHeader)

  resetHandoffBody(nextBody)
  stage.replaceChildren(nextBody)

  if (!sharedSource || !targetPrimary?.classList.contains('focus-course')) {
    const incomingPrimary = transitionPrimary(nextBody)
    await animateElement(incomingPrimary, [
      { opacity: 0, transform: 'translateY(34px) scale(.96)', filter: 'blur(5px)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
    ], { duration: 1500, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' })
    if (token !== transitionToken) return
  }

  stage.classList.add('is-size-settling')
  const targetHeight = nextBody.getBoundingClientRect().height
  const nextFollowing = transitionSecondary(nextBody)
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

  stage.style.removeProperty('height')
  stage.replaceWith(nextBody)
  finishCourseTransition(token, resumeAfterTransition)
}

function renderWidget(allowTransition = true, timestamp = performance.now()): boolean {
  const nextWidget = buildWidget()
  const currentWidget = app.querySelector<HTMLElement>('.course-widget')
  const courseChanged = courseIdentityKey(currentWidget) !== courseIdentityKey(nextWidget)

  if (currentWidget && !courseChanged) {
    syncStableWidget(currentWidget, nextWidget)
    return false
  }

  const shouldAnimate = allowTransition
    && !transitionActive
    && presentationClock.isActive()
    && courseChanged
    && Boolean(currentWidget)
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!shouldAnimate || !currentWidget) {
    if (!currentWidget) {
      nextWidget.classList.add('is-initial-mount')
      window.setTimeout(() => nextWidget.classList.remove('is-initial-mount'), 520)
    }
    app.replaceChildren(nextWidget)
    return false
  }

  const resumeAfterTransition = presentationClock.isPlaying()
  const frozen = resumeAfterTransition
    ? presentationClock.pause(timestamp)
    : presentationClock.snapshot(timestamp)
  transitionActive = true
  presentationMessage = '课程正在交接，演示时间已暂停。'
  document.documentElement.classList.add('is-course-transitioning')
  const token = ++transitionToken
  publishPresentationStatus(frozen, true)

  void runCourseHandoff(token, currentWidget, nextWidget, resumeAfterTransition).catch((error: unknown) => {
    console.error('[presentation] course handoff failed', error)
    if (token !== transitionToken) return
    collapseHandoffStage()
    syncStableWidget(currentWidget, nextWidget)
    finishCourseTransition(token, resumeAfterTransition)
  })
  return true
}

function clearClockTimers() {
  if (minuteTimeout !== undefined) window.clearTimeout(minuteTimeout)
  if (minuteInterval !== undefined) window.clearInterval(minuteInterval)
  minuteTimeout = undefined
  minuteInterval = undefined
}

function clearPresentationFrame() {
  if (presentationFrame !== undefined) window.cancelAnimationFrame(presentationFrame)
  presentationFrame = undefined
}

function formatPresentationTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function presentationStatus(snapshot?: ReplaySnapshot): PresentationStatus {
  const current = snapshot ?? (presentationClock.isActive() ? presentationClock.snapshot(performance.now()) : undefined)
  return {
    active: Boolean(current?.active),
    playing: Boolean(current?.playing),
    transitioning: transitionActive,
    finished: Boolean(current?.finished),
    progress: current?.progress ?? 0,
    time: current ? formatPresentationTime(current.date) : '',
    message: presentationMessage,
  }
}

function publishPresentationStatus(snapshot?: ReplaySnapshot, force = false) {
  if (!desktopRuntime) return
  const status = presentationStatus(snapshot)
  const percent = Math.round(status.progress * 100)
  if (!force && percent === lastPublishedPercent) return
  lastPublishedPercent = percent
  void emit(PRESENTATION_STATUS_EVENT, status)
}

function applyPresentationSnapshot(
  snapshot: ReplaySnapshot,
  force = false,
  timestamp = performance.now(),
  allowTransition = true,
): boolean {
  options.now = snapshot.date
  const minute = Math.floor(snapshot.date.getTime() / 60_000)
  if (force || minute !== lastPresentationMinute) {
    lastPresentationMinute = minute
    if (renderWidget(allowTransition, timestamp)) return true
  }
  publishPresentationStatus(snapshot, force)
  return false
}

function presentationTick(timestamp: number) {
  if (transitionActive) return
  const snapshot = presentationClock.snapshot(timestamp)
  const transitionStarted = applyPresentationSnapshot(snapshot, false, timestamp, true)
  if (transitionStarted) {
    presentationFrame = undefined
    return
  }
  if (snapshot.playing) {
    presentationFrame = window.requestAnimationFrame(presentationTick)
  } else {
    presentationFrame = undefined
    applyPresentationSnapshot(snapshot, true, timestamp, true)
  }
}

function startPresentation(config: ReplayConfig) {
  if (options.runtime !== 'live') return
  try {
    clearCourseTransition()
    const snapshot = presentationClock.start(config, performance.now())
    if (!presentationRestore) {
      presentationRestore = { showNav: options.showNav, closeControl: options.closeControl, browseDate: options.browseDate }
    }
    options.showNav = false
    options.closeControl = false
    options.browseDate = undefined
    presentationMessage = presentationPlayingMessage()
    document.documentElement.classList.add('is-presentation-replay')
    clearClockTimers()
    clearPresentationFrame()
    lastPresentationMinute = Number.NaN
    lastPublishedPercent = -1
    applyPresentationSnapshot(snapshot, true, performance.now(), false)
    presentationFrame = window.requestAnimationFrame(presentationTick)
  } catch (error) {
    presentationMessage = error instanceof Error ? error.message : String(error)
    publishPresentationStatus(undefined, true)
  }
}

function togglePresentation() {
  if (!presentationClock.isActive() || transitionActive) return
  try {
    const snapshot = presentationClock.toggle(performance.now())
    presentationMessage = snapshot.playing ? presentationPlayingMessage() : '演示已暂停。'
    clearPresentationFrame()
    applyPresentationSnapshot(snapshot, true, performance.now(), false)
    if (snapshot.playing) presentationFrame = window.requestAnimationFrame(presentationTick)
  } catch (error) {
    presentationMessage = error instanceof Error ? error.message : String(error)
    publishPresentationStatus(undefined, true)
  }
}

function setPresentationSpeed(minutesPerSecond: number) {
  if (!presentationClock.isActive() || transitionActive) return
  try {
    const snapshot = presentationClock.setSpeed(minutesPerSecond, performance.now())
    presentationMessage = presentationPlayingMessage('流速已调整')
    publishPresentationStatus(snapshot, true)
  } catch (error) {
    presentationMessage = error instanceof Error ? error.message : String(error)
    publishPresentationStatus(undefined, true)
  }
}

function restartPresentation() {
  if (!presentationClock.isActive()) return
  clearCourseTransition()
  const snapshot = presentationClock.restart(performance.now())
  presentationMessage = presentationPlayingMessage('演示已重播')
  clearPresentationFrame()
  lastPresentationMinute = Number.NaN
  lastPublishedPercent = -1
  applyPresentationSnapshot(snapshot, true, performance.now(), false)
  presentationFrame = window.requestAnimationFrame(presentationTick)
}

function stopPresentation() {
  clearCourseTransition()
  if (!presentationClock.isActive()) {
    publishPresentationStatus(undefined, true)
    return
  }
  presentationClock.stop()
  clearPresentationFrame()
  options.now = undefined
  if (presentationRestore) {
    options.showNav = presentationRestore.showNav
    options.closeControl = presentationRestore.closeControl
    options.browseDate = presentationRestore.browseDate
  }
  presentationRestore = null
  lastPresentationMinute = Number.NaN
  lastPublishedPercent = -1
  presentationMessage = '已恢复真实时间。'
  document.documentElement.classList.remove('is-presentation-replay')
  syncLiveWidget()
  publishPresentationStatus(undefined, true)
}

function handlePresentationCommand(command: PresentationCommand) {
  if (command.type === 'start') startPresentation(command.config)
  if (command.type === 'set-speed') setPresentationSpeed(command.minutesPerSecond)
  if (command.type === 'toggle') togglePresentation()
  if (command.type === 'restart') restartPresentation()
  if (command.type === 'stop') stopPresentation()
}

async function openPresentationController() {
  if (!desktopRuntime) return
  const controller = await WebviewWindow.getByLabel('presentation')
  if (!controller) {
    console.error('[presentation] controller window is unavailable')
    return
  }
  await controller.show()
  await controller.setFocus()
  publishPresentationStatus(undefined, true)
}

function syncLiveWidget() {
  if (options.runtime !== 'live') return
  if (presentationClock.isActive()) {
    if (transitionActive) {
      publishPresentationStatus(undefined, true)
      return
    }
    applyPresentationSnapshot(presentationClock.snapshot(performance.now()), true, performance.now(), false)
    return
  }
  options.now = undefined
  renderWidget(false)
  clearClockTimers()
  const now = new Date()
  const untilNextMinute = 60_000 - now.getSeconds() * 1_000 - now.getMilliseconds()
  minuteTimeout = window.setTimeout(() => {
    renderWidget(false)
    minuteInterval = window.setInterval(() => renderWidget(false), 60_000)
  }, untilNextMinute)
}

type AppSettingsSnapshot = {
  onboardingCompleted: boolean
}

async function startDesktopWidget() {
  const [{ invoke }, { startDesktopShell }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('./desktop-shell'),
  ])
  const refreshSchedule = async () => {
    try {
      setActiveSchedule(await invoke<ScheduleSource>('read_schedule'))
    } catch (error) {
      clearActiveSchedule()
      console.error('[widget] schedule load failed', error)
    }
    syncLiveWidget()
  }
  let shellStarted = false
  const startShellOnce = async () => {
    if (shellStarted) return
    shellStarted = true
    await startDesktopShell(app)
  }

  await listen('schedule:updated', refreshSchedule)
  await listen('widget:shown', syncLiveWidget)
  await listen<PresentationCommand>(PRESENTATION_COMMAND_EVENT, ({ payload }) => handlePresentationCommand(payload))
  await listen(PRESENTATION_STATUS_REQUEST_EVENT, () => publishPresentationStatus(undefined, true))
  await listen('onboarding:completed', async () => {
    await refreshSchedule()
    await startShellOnce()
  })
  await refreshSchedule()

  try {
    const settings = await invoke<AppSettingsSnapshot>('read_app_settings')
    if (settings.onboardingCompleted) await startShellOnce()
  } catch (error) {
    console.error('[widget] settings load failed', error)
    await startShellOnce()
  }
}

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
    event.preventDefault()
    void openPresentationController()
    return
  }
  if (!presentationClock.isActive()) return
  if (event.code === 'Space') {
    event.preventDefault()
    togglePresentation()
  }
  if (event.code === 'Escape') {
    event.preventDefault()
    stopPresentation()
  }
})

if (options.runtime === 'live') {
  if (!desktopRuntime) syncLiveWidget()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncLiveWidget()
  })
  window.addEventListener('focus', syncLiveWidget)
  window.addEventListener('beforeunload', () => {
    clearClockTimers()
    clearPresentationFrame()
    clearCourseTransition()
  })
  if (desktopRuntime) void startDesktopWidget().catch((error: unknown) => console.error('[widget] desktop startup failed', error))
} else {
  renderWidget(false)
}
