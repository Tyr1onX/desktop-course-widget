import './style.css'
import './widget-page.css'
import './time-flow.css'
import { isTauri } from '@tauri-apps/api/core'
import { PresentationClock, withPresentationDate, type ReplayConfig, type ReplaySnapshot } from './presentation-clock'
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

const presentationClock = new PresentationClock()
let activeSchedule: ScheduleSource | null = null
let presentationPanel: HTMLElement | null = null
let presentationDate: Date | undefined
let presentationFrame: number | undefined
let minuteTimeout: number | undefined
let minuteInterval: number | undefined
let lastPresentationMinute = Number.NaN
let presentationRestore: Pick<WidgetOptions, 'showNav' | 'closeControl' | 'browseDate'> | null = null

function renderWidget() {
  const buildWidget = () => enhanceTimeFlow(createWidget(options, renderWidget), options)
  app.replaceChildren(presentationDate ? withPresentationDate(presentationDate, buildWidget) : buildWidget())
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

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + days)
  return result
}

function recommendedPresentationDate(schedule: ScheduleSource): string {
  const semesterStart = parseLocalDate(schedule.semesterStart)
  const weeks = schedule.courses.flatMap((course) => course.weeks)
  const firstWeek = weeks.length ? Math.min(...weeks) : 1
  if (!semesterStart || !schedule.courses.length) return localDateKey(new Date())

  const weekStart = addDays(semesterStart, Math.max(0, firstWeek - 1) * 7)
  let bestDate = weekStart
  let bestCourseCount = -1
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(weekStart, offset)
    const weekday = candidate.getDay()
    const count = schedule.courses.filter((course) => {
      const courseWeekday = course.weekday % 7
      const parityMatches = course.parity === 'all' || (course.parity === 'odd' ? firstWeek % 2 === 1 : firstWeek % 2 === 0)
      return courseWeekday === weekday && course.weeks.includes(firstWeek) && parityMatches
    }).length
    if (count > bestCourseCount) {
      bestCourseCount = count
      bestDate = candidate
    }
  }
  return localDateKey(bestDate)
}

function setPresentationMessage(message: string) {
  const target = presentationPanel?.querySelector<HTMLElement>('[data-presentation-message]')
  if (target) target.textContent = message
}

function setPresentationPanelVisible(visible: boolean) {
  const panel = ensurePresentationPanel()
  panel.hidden = !visible
  if (visible) panel.querySelector<HTMLInputElement>('[data-presentation-date]')?.focus()
}

function ensurePresentationPanel(): HTMLElement {
  if (presentationPanel) return presentationPanel
  const panel = document.createElement('section')
  panel.className = 'presentation-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', '时间回放演示模式')
  panel.innerHTML = `
    <header class="presentation-panel__header">
      <div><strong>时间回放</strong><span>隐藏演示工具</span></div>
      <button type="button" data-presentation-hide aria-label="隐藏控制面板">×</button>
    </header>
    <div class="presentation-panel__grid">
      <label class="presentation-field presentation-field--wide"><span>演示日期</span><input type="date" data-presentation-date /></label>
      <label class="presentation-field"><span>开始</span><input type="time" value="08:00" data-presentation-start /></label>
      <label class="presentation-field"><span>结束</span><input type="time" value="22:00" data-presentation-end /></label>
      <label class="presentation-field"><span>压缩为</span><input type="number" min="3" max="300" step="1" value="15" data-presentation-duration /></label>
      <label class="presentation-loop"><input type="checkbox" checked data-presentation-loop /><span>循环播放</span></label>
    </div>
    <div class="presentation-status">
      <time data-presentation-time>尚未开始</time>
      <span data-presentation-progress>Ctrl + Shift + D 显示或隐藏</span>
    </div>
    <p class="presentation-message" data-presentation-message></p>
    <div class="presentation-actions">
      <button class="presentation-primary" type="button" data-presentation-start-button>开始回放</button>
      <button type="button" data-presentation-toggle disabled>暂停</button>
      <button type="button" data-presentation-restart disabled>重播</button>
      <button type="button" data-presentation-exit disabled>退出</button>
    </div>
  `
  document.body.append(panel)
  presentationPanel = panel

  const dateInput = panel.querySelector<HTMLInputElement>('[data-presentation-date]')!
  dateInput.value = activeSchedule ? recommendedPresentationDate(activeSchedule) : localDateKey(new Date())
  panel.querySelector('[data-presentation-hide]')?.addEventListener('click', () => setPresentationPanelVisible(false))
  panel.querySelector('[data-presentation-start-button]')?.addEventListener('click', startPresentation)
  panel.querySelector('[data-presentation-toggle]')?.addEventListener('click', togglePresentation)
  panel.querySelector('[data-presentation-restart]')?.addEventListener('click', restartPresentation)
  panel.querySelector('[data-presentation-exit]')?.addEventListener('click', stopPresentation)
  return panel
}

function presentationConfig(): ReplayConfig {
  const panel = ensurePresentationPanel()
  return {
    date: panel.querySelector<HTMLInputElement>('[data-presentation-date]')?.value ?? '',
    start: panel.querySelector<HTMLInputElement>('[data-presentation-start]')?.value ?? '',
    end: panel.querySelector<HTMLInputElement>('[data-presentation-end]')?.value ?? '',
    durationSeconds: Number(panel.querySelector<HTMLInputElement>('[data-presentation-duration]')?.value),
    loop: panel.querySelector<HTMLInputElement>('[data-presentation-loop]')?.checked ?? false,
  }
}

function updatePresentationControls(snapshot?: ReplaySnapshot) {
  const panel = ensurePresentationPanel()
  const active = presentationClock.isActive()
  const current = snapshot ?? (active ? presentationClock.snapshot(performance.now()) : undefined)
  const time = panel.querySelector<HTMLElement>('[data-presentation-time]')
  const progress = panel.querySelector<HTMLElement>('[data-presentation-progress]')
  const toggle = panel.querySelector<HTMLButtonElement>('[data-presentation-toggle]')
  const restart = panel.querySelector<HTMLButtonElement>('[data-presentation-restart]')
  const exit = panel.querySelector<HTMLButtonElement>('[data-presentation-exit]')
  if (time) time.textContent = current ? current.date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未开始'
  if (progress) progress.textContent = current ? `${Math.round(current.progress * 100)}% · ${current.playing ? '播放中' : current.finished ? '已完成' : '已暂停'}` : 'Ctrl + Shift + D 显示或隐藏'
  if (toggle) {
    toggle.disabled = !active
    toggle.textContent = current?.playing ? '暂停' : '继续'
  }
  if (restart) restart.disabled = !active
  if (exit) exit.disabled = !active
}

function applyPresentationSnapshot(snapshot: ReplaySnapshot, force = false) {
  presentationDate = snapshot.date
  const minute = Math.floor(snapshot.date.getTime() / 60_000)
  if (force || minute !== lastPresentationMinute) {
    lastPresentationMinute = minute
    renderWidget()
    updatePresentationControls(snapshot)
  }
}

function presentationTick(timestamp: number) {
  const snapshot = presentationClock.snapshot(timestamp)
  applyPresentationSnapshot(snapshot)
  if (snapshot.playing) {
    presentationFrame = window.requestAnimationFrame(presentationTick)
  } else {
    presentationFrame = undefined
    applyPresentationSnapshot(snapshot, true)
    setPresentationPanelVisible(true)
  }
}

function startPresentation() {
  if (options.runtime !== 'live') {
    setPresentationMessage('演示模式需要在桌面应用或实时调试页面中使用。')
    return
  }
  try {
    const snapshot = presentationClock.start(presentationConfig(), performance.now())
    if (!presentationRestore) {
      presentationRestore = { showNav: options.showNav, closeControl: options.closeControl, browseDate: options.browseDate }
    }
    options.showNav = false
    options.closeControl = false
    options.browseDate = undefined
    document.documentElement.classList.add('is-presentation-replay')
    setPresentationMessage('演示时间只影响画面，不会修改系统时间或课表数据。')
    clearClockTimers()
    clearPresentationFrame()
    lastPresentationMinute = Number.NaN
    applyPresentationSnapshot(snapshot, true)
    presentationFrame = window.requestAnimationFrame(presentationTick)
    window.setTimeout(() => {
      if (presentationClock.isPlaying()) setPresentationPanelVisible(false)
    }, 700)
  } catch (error) {
    setPresentationMessage(error instanceof Error ? error.message : String(error))
  }
}

function togglePresentation() {
  if (!presentationClock.isActive()) return
  try {
    const snapshot = presentationClock.toggle(performance.now())
    clearPresentationFrame()
    applyPresentationSnapshot(snapshot, true)
    if (snapshot.playing) {
      presentationFrame = window.requestAnimationFrame(presentationTick)
      setPresentationPanelVisible(false)
    } else {
      setPresentationPanelVisible(true)
    }
  } catch (error) {
    setPresentationMessage(error instanceof Error ? error.message : String(error))
  }
}

function restartPresentation() {
  if (!presentationClock.isActive()) return
  const snapshot = presentationClock.restart(performance.now())
  clearPresentationFrame()
  lastPresentationMinute = Number.NaN
  applyPresentationSnapshot(snapshot, true)
  presentationFrame = window.requestAnimationFrame(presentationTick)
  setPresentationPanelVisible(false)
}

function stopPresentation() {
  if (!presentationClock.isActive()) return
  presentationClock.stop()
  clearPresentationFrame()
  presentationDate = undefined
  if (presentationRestore) {
    options.showNav = presentationRestore.showNav
    options.closeControl = presentationRestore.closeControl
    options.browseDate = presentationRestore.browseDate
  }
  presentationRestore = null
  lastPresentationMinute = Number.NaN
  document.documentElement.classList.remove('is-presentation-replay')
  setPresentationMessage('已恢复真实时间。')
  updatePresentationControls()
  syncLiveWidget()
}

function syncLiveWidget() {
  if (options.runtime !== 'live') return
  if (presentationClock.isActive()) {
    const snapshot = presentationClock.snapshot(performance.now())
    applyPresentationSnapshot(snapshot, true)
    return
  }
  presentationDate = undefined
  renderWidget()
  clearClockTimers()
  const now = new Date()
  const untilNextMinute = 60_000 - now.getSeconds() * 1_000 - now.getMilliseconds()
  minuteTimeout = window.setTimeout(() => {
    renderWidget()
    minuteInterval = window.setInterval(renderWidget, 60_000)
  }, untilNextMinute)
}

type AppSettingsSnapshot = {
  onboardingCompleted: boolean
}

async function startDesktopWidget() {
  const [{ invoke }, { listen }, { startDesktopShell }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('./desktop-shell'),
  ])
  const refreshSchedule = async () => {
    try {
      activeSchedule = await invoke<ScheduleSource>('read_schedule')
      setActiveSchedule(activeSchedule)
      const dateInput = presentationPanel?.querySelector<HTMLInputElement>('[data-presentation-date]')
      if (dateInput && !presentationClock.isActive()) dateInput.value = recommendedPresentationDate(activeSchedule)
    } catch (error) {
      activeSchedule = null
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
  const target = event.target instanceof HTMLElement ? event.target : null
  const editing = Boolean(target?.closest('input, select, textarea'))
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
    event.preventDefault()
    setPresentationPanelVisible(Boolean(ensurePresentationPanel().hidden))
    updatePresentationControls()
    return
  }
  if (!presentationClock.isActive() || editing) return
  if (event.code === 'Space') {
    event.preventDefault()
    togglePresentation()
  }
  if (event.code === 'Escape') {
    event.preventDefault()
    stopPresentation()
    setPresentationPanelVisible(false)
  }
})

if (query.get('demo') === '1') setPresentationPanelVisible(true)

if (options.runtime === 'live') {
  if (!desktopRuntime) syncLiveWidget()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncLiveWidget()
  })
  window.addEventListener('focus', syncLiveWidget)
  window.addEventListener('beforeunload', () => {
    clearClockTimers()
    clearPresentationFrame()
  })
  if (desktopRuntime) void startDesktopWidget().catch((error: unknown) => console.error('[widget] desktop startup failed', error))
} else {
  renderWidget()
}
