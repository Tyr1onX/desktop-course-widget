import './presentation-page.css'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  PRESENTATION_COMMAND_EVENT,
  PRESENTATION_STATUS_EVENT,
  PRESENTATION_STATUS_REQUEST_EVENT,
  type PresentationCommand,
  type PresentationStatus,
} from './presentation-events'
import type { ReplayConfig } from './presentation-clock'
import type { ScheduleSource } from './widget'

const app = document.querySelector<HTMLElement>('#app')!
const controllerWindow = getCurrentWindow()

app.innerHTML = `
  <section class="controller-shell">
    <header class="controller-header">
      <div>
        <p class="eyebrow">课刻演示工具</p>
        <h1>时间回放</h1>
        <p>控制器与课刻组件分离，录制时只捕获课刻窗口。</p>
      </div>
      <span class="controller-badge">隐藏功能</span>
    </header>

    <section class="controller-card" aria-labelledby="timeline-title">
      <div class="section-heading">
        <div><p>回放范围</p><h2 id="timeline-title">压缩一天的时间</h2></div>
        <button type="button" class="quiet-button" data-preset>宣传预设 · 36 秒</button>
      </div>
      <div class="form-grid">
        <label class="field field-wide"><span>演示日期</span><input type="date" data-date /></label>
        <label class="field"><span>开始</span><input type="time" value="08:00" data-start /></label>
        <label class="field"><span>结束</span><input type="time" value="22:00" data-end /></label>
        <label class="field"><span>时长（秒）</span><input type="number" min="3" max="300" step="1" value="45" data-duration /></label>
        <label class="check-field"><input type="checkbox" checked data-loop /><span>循环播放</span></label>
      </div>
      <p class="field-hint" data-date-hint>正在读取当前课表并选择课程较多的一天…</p>
      <p class="field-hint">课程切换时会自动暂停演示时间，转场完成后才继续。</p>
    </section>

    <section class="controller-card status-card" aria-live="polite">
      <div class="status-copy">
        <span data-state>尚未开始</span>
        <strong data-time>--:--</strong>
      </div>
      <div class="progress-track" aria-hidden="true"><span data-progress-bar></span></div>
      <p data-message>演示只改变课刻画面，不会修改系统时间或课表数据。</p>
    </section>

    <div class="controller-actions">
      <button type="button" class="primary-action" data-start-button>开始回放</button>
      <button type="button" data-toggle disabled>暂停</button>
      <button type="button" data-restart disabled>重播</button>
      <button type="button" data-stop disabled>退出演示</button>
    </div>

    <footer class="controller-footer">
      <span>Ctrl + Shift + D 打开控制器</span>
      <span>Space 暂停 / 继续</span>
      <span>转场时自动停表</span>
    </footer>
  </section>
`

const dateInput = app.querySelector<HTMLInputElement>('[data-date]')!
const startInput = app.querySelector<HTMLInputElement>('[data-start]')!
const endInput = app.querySelector<HTMLInputElement>('[data-end]')!
const durationInput = app.querySelector<HTMLInputElement>('[data-duration]')!
const loopInput = app.querySelector<HTMLInputElement>('[data-loop]')!
const stateText = app.querySelector<HTMLElement>('[data-state]')!
const timeText = app.querySelector<HTMLElement>('[data-time]')!
const progressBar = app.querySelector<HTMLElement>('[data-progress-bar]')!
const messageText = app.querySelector<HTMLElement>('[data-message]')!
const dateHint = app.querySelector<HTMLElement>('[data-date-hint]')!
const toggleButton = app.querySelector<HTMLButtonElement>('[data-toggle]')!
const restartButton = app.querySelector<HTMLButtonElement>('[data-restart]')!
const stopButton = app.querySelector<HTMLButtonElement>('[data-stop]')!

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
      const parityMatches = course.parity === 'all' || (course.parity === 'odd' ? firstWeek % 2 === 1 : firstWeek % 2 === 0)
      return course.weekday % 7 === weekday && course.weeks.includes(firstWeek) && parityMatches
    }).length
    if (count > bestCourseCount) {
      bestCourseCount = count
      bestDate = candidate
    }
  }
  return localDateKey(bestDate)
}

function replayConfig(): ReplayConfig {
  return {
    date: dateInput.value,
    start: startInput.value,
    end: endInput.value,
    durationSeconds: Number(durationInput.value),
    loop: loopInput.checked,
  }
}

async function send(command: PresentationCommand) {
  await emit(PRESENTATION_COMMAND_EVENT, command)
}

function updateStatus(status: PresentationStatus) {
  stateText.textContent = status.transitioning
    ? '课程转场'
    : status.active
      ? status.playing
        ? '播放中'
        : status.finished
          ? '回放完成'
          : '已暂停'
      : '尚未开始'
  timeText.textContent = status.time || '--:--'
  progressBar.style.width = `${Math.round(status.progress * 100)}%`
  messageText.textContent = status.message || '演示只改变课刻画面，不会修改系统时间或课表数据。'
  toggleButton.disabled = !status.active || status.transitioning
  restartButton.disabled = !status.active || status.transitioning
  stopButton.disabled = !status.active
  toggleButton.textContent = status.playing ? '暂停' : '继续'
}

async function loadRecommendedDate() {
  try {
    const schedule = await invoke<ScheduleSource>('read_schedule')
    dateInput.value = recommendedPresentationDate(schedule)
    dateHint.textContent = `已选择当前课表中课程较多的一天：${dateInput.value.replaceAll('-', '/')}`
  } catch (error) {
    dateInput.value = localDateKey(new Date())
    dateHint.textContent = `无法读取课表，已使用今天。${error instanceof Error ? error.message : ''}`
  }
}

app.querySelector('[data-preset]')?.addEventListener('click', () => {
  startInput.value = '07:30'
  endInput.value = '22:00'
  durationInput.value = '36'
  loopInput.checked = true
})
app.querySelector('[data-start-button]')?.addEventListener('click', () => void send({ type: 'start', config: replayConfig() }))
toggleButton.addEventListener('click', () => void send({ type: 'toggle' }))
restartButton.addEventListener('click', () => void send({ type: 'restart' }))
stopButton.addEventListener('click', () => void send({ type: 'stop' }))

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('input, select, textarea')) return
  if (event.code === 'Space') {
    event.preventDefault()
    void send({ type: 'toggle' })
  }
  if (event.code === 'Escape') {
    event.preventDefault()
    void send({ type: 'stop' })
  }
})

await listen<PresentationStatus>(PRESENTATION_STATUS_EVENT, ({ payload }) => updateStatus(payload))
await controllerWindow.onCloseRequested(async (event) => {
  event.preventDefault()
  await controllerWindow.hide()
})
await controllerWindow.onFocusChanged(({ payload }) => {
  if (payload) void emit(PRESENTATION_STATUS_REQUEST_EVENT)
})
await loadRecommendedDate()
await emit(PRESENTATION_STATUS_REQUEST_EVENT)
