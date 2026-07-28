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

const COURSE_TRANSITION_SETTLE_MS = 1800
const presentationClock = new PresentationClock()
let presentationFrame: number | undefined
let minuteTimeout: number | undefined
let minuteInterval: number | undefined
let transitionTimer: number | undefined
let transitionToken = 0
let transitionActive = false
let lastPresentationMinute = Number.NaN
let lastPublishedPercent = -1
let presentationMessage = '演示只改变课刻画面，不会修改系统时间或课表数据。'
let presentationRestore: Pick<WidgetOptions, 'showNav' | 'closeControl' | 'browseDate'> | null = null

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

function buildWidget() {
  return enhanceTimeFlow(createWidget(options, renderWidget), options)
}

function transitionKey(widget: HTMLElement | null) {
  if (!widget) return ''
  const focus = widget.querySelector<HTMLElement>('.focus-course')
  const phase = focus?.classList.contains('is-current') ? 'current' : focus ? 'upcoming' : 'none'
  const course = focus?.querySelector<HTMLElement>('h2')?.textContent ?? ''
  const courseTime = focus?.querySelector<HTMLElement>('.course-time')?.textContent ?? ''
  const state = widget.querySelector<HTMLElement>('.state-label')?.textContent ?? ''
  const focusDate = focus?.querySelector<HTMLElement>('.course-date')?.textContent ?? ''
  const controls = `${Boolean(widget.querySelector('.date-nav'))}|${Boolean(widget.querySelector('.widget-close'))}`
  return `${phase}|${course}|${courseTime}|${state}|${focusDate}|${controls}`
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

function clearCourseTransition() {
  transitionToken += 1
  if (transitionTimer !== undefined) window.clearTimeout(transitionTimer)
  transitionTimer = undefined
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

function renderWidget(allowTransition = true, timestamp = performance.now()): boolean {
  const nextWidget = buildWidget()
  const currentWidget = app.querySelector<HTMLElement>('.course-widget')
  const transitionDocument = document as TransitionDocument
  const stateChanged = transitionKey(currentWidget) !== transitionKey(nextWidget)

  if (currentWidget && !stateChanged) {
    syncStableWidget(currentWidget, nextWidget)
    return false
  }

  const shouldAnimate = allowTransition
    && !transitionActive
    && presentationClock.isActive()
    && stateChanged
    && Boolean(transitionDocument.startViewTransition)
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const replace = () => app.replaceChildren(nextWidget)

  if (!shouldAnimate || !transitionDocument.startViewTransition) {
    replace()
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

  const transition = transitionDocument.startViewTransition(replace)
  void transition.finished.finally(() => finishCourseTransition(token, resumeAfterTransition))
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
