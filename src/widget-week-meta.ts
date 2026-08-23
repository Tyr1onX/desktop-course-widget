import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import scheduleData from './data/schedule.json'
import './widget-vnext.css'

type SourceCourse = {
  weeks: number[]
}

type ScheduleSource = {
  semesterStart: string
  semesterEnd?: string | null
  courses: SourceCourse[]
}

const app = document.querySelector<HTMLDivElement>('#app')
const desktopRuntime = isTauri()
let schedule = scheduleData as ScheduleSource
let renderQueued = false

function parseLocalDate(value?: string | null): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function addDays(value: Date, days: number): Date {
  const result = startOfDay(value)
  result.setDate(result.getDate() + days)
  return result
}

function maximumWeek(): number {
  const courseMaximum = Math.max(0, ...schedule.courses.flatMap((course) => course.weeks ?? []))
  const start = parseLocalDate(schedule.semesterStart)
  const end = parseLocalDate(schedule.semesterEnd)
  if (!start || !end) return courseMaximum
  const days = Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000) + 1
  const calendarMaximum = days > 0 ? Math.ceil(days / 7) : 0
  return Math.max(courseMaximum, calendarMaximum)
}

function dateFromWidget(widget: HTMLElement): Date | undefined {
  const title = widget.querySelector<HTMLElement>('.widget-title')?.textContent ?? ''
  const match = title.match(/(\d{1,2})月(\d{1,2})日/)
  const start = parseLocalDate(schedule.semesterStart)
  if (!match || !start) return undefined

  const month = Number(match[1])
  const day = Number(match[2])
  const candidates = [
    new Date(start.getFullYear() - 1, month - 1, day),
    new Date(start.getFullYear(), month - 1, day),
    new Date(start.getFullYear() + 1, month - 1, day),
  ]
  const total = Math.max(maximumWeek(), 1)
  const semesterLastDay = addDays(start, total * 7 - 1)
  const withinSemester = candidates.find((candidate) => candidate >= start && candidate <= semesterLastDay)
  if (withinSemester) return withinSemester

  return candidates.sort((left, right) => Math.abs(left.getTime() - start.getTime()) - Math.abs(right.getTime() - start.getTime()))[0]
}

function teachingWeek(date: Date): number | undefined {
  const start = parseLocalDate(schedule.semesterStart)
  if (!start) return undefined
  const week = Math.floor((startOfDay(date).getTime() - startOfDay(start).getTime()) / 604_800_000) + 1
  return week > 0 ? week : undefined
}

function formatMonthDay(value: Date): string {
  return `${value.getMonth() + 1}月${value.getDate()}日`
}

function renderWeekMeta(): void {
  renderQueued = false
  const widget = app?.querySelector<HTMLElement>('.course-widget')
  if (!widget) return

  const date = dateFromWidget(widget)
  const start = parseLocalDate(schedule.semesterStart)
  const week = date ? teachingWeek(date) : undefined
  const total = maximumWeek()
  const existing = widget.querySelector<HTMLElement>('.widget-week-meta')

  if (!date || !start || !week || total < 1 || week > total) {
    existing?.remove()
    return
  }

  const weekStart = addDays(start, (week - 1) * 7)
  const weekEnd = addDays(weekStart, 6)
  const countText = `教学周 ${week} / ${total}`
  const rangeText = `${formatMonthDay(weekStart)} – ${formatMonthDay(weekEnd)}`

  if (existing) {
    const count = existing.querySelector<HTMLElement>('[data-week-count]')
    const range = existing.querySelector<HTMLElement>('[data-week-range]')
    if (count?.textContent !== countText) count!.textContent = countText
    if (range?.textContent !== rangeText) range!.textContent = rangeText
    return
  }

  const footer = document.createElement('footer')
  footer.className = 'widget-week-meta'
  footer.setAttribute('aria-label', '教学周信息')
  footer.innerHTML = `
    <span class="widget-week-count" data-week-count>${countText}</span>
    <span class="widget-week-range" data-week-range>${rangeText}</span>
  `
  widget.append(footer)
}

function queueRender(): void {
  if (renderQueued) return
  renderQueued = true
  window.requestAnimationFrame(renderWeekMeta)
}

async function refreshSchedule(): Promise<void> {
  if (desktopRuntime) {
    try {
      schedule = await invoke<ScheduleSource>('read_schedule')
    } catch (error) {
      console.error('[widget-week-meta] schedule load failed', error)
    }
  }
  queueRender()
}

if (app) {
  new MutationObserver(queueRender).observe(app, { childList: true, subtree: true, characterData: true })
  void refreshSchedule()

  if (desktopRuntime) {
    void listen('schedule:updated', () => void refreshSchedule())
    void listen('widget:shown', queueRender)
  }
}
