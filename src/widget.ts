import scheduleData from './data/schedule.json'
import { isTauri } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

type Scenario = 'current' | 'between' | 'ended' | 'empty' | 'before' | 'browsing'
type Theme = 'light' | 'dark'
type Background = 'blue' | 'light' | 'dark' | 'colorful'
type Runtime = 'prototype' | 'live'
type ModelMode = 'current' | 'next' | 'next-date' | 'empty' | 'before' | 'browsing' | 'after' | 'error'
type SemesterState = 'before' | 'in-progress' | 'after'

interface SourceCourse {
  name: string
  teacher: string
  weekday: number
  start: string
  end: string
  location: string
  weeks: number[]
  parity: 'all' | 'odd' | 'even'
}

export interface ScheduleSource {
  schemaVersion?: number
  semesterStart: string
  semesterEnd?: string
  courses: SourceCourse[]
}

interface DisplayCourse {
  name: string
  start: string
  end: string
  location: string
}

interface WidgetModel {
  date: Date
  now: string
  isToday: boolean
  mode: ModelMode
  focus?: DisplayCourse
  focusDate?: Date
  following: DisplayCourse[]
  stateLabel?: string
  openingDate?: Date
  emptyMessage?: string
}

export interface WidgetOptions {
  runtime: Runtime
  scenario: Scenario
  theme: Theme
  background: Background
  width: number
  scale: number
  longName: boolean
  longLocation: boolean
  followCount: number
  showNav: boolean
  time: string
  browsingOffset: number
  browseDate?: Date
  dragRegion: boolean
  closeControl: boolean
  now?: Date
}

export const defaultOptions: WidgetOptions = {
  runtime: 'prototype',
  scenario: 'current',
  theme: 'light',
  background: 'blue',
  width: 360,
  scale: 1,
  longName: false,
  longLocation: false,
  followCount: 3,
  showNav: true,
  time: '08:48',
  browsingOffset: 0,
  dragRegion: false,
  closeControl: false,
}

let schedule = scheduleData as ScheduleSource
let courses = Array.isArray(schedule.courses) ? schedule.courses : []

export function setActiveSchedule(nextSchedule: ScheduleSource) {
  schedule = nextSchedule
  courses = Array.isArray(schedule.courses) ? schedule.courses : []
}

export function clearActiveSchedule() {
  schedule = { semesterStart: '', courses: [] }
  courses = []
}
const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const prototypeDate = new Date(2026, 8, 21)

const parseTime = (time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

const formatTime = (date: Date) => date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date: Date, days: number) => {
  const result = startOfDay(date)
  result.setDate(result.getDate() + days)
  return result
}
function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameLocalDate(left: Date, right: Date) {
  return toLocalDateKey(left) === toLocalDateKey(right)
}

const formatMonthDay = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`
const formatCourseDate = (date: Date) => `${formatMonthDay(date)} · ${weekdayNames[date.getDay()]}`

function semesterStart() {
  const [year, month, day] = schedule.semesterStart?.split('-').map(Number) ?? []
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function maximumWeek() {
  return Math.max(0, ...courses.flatMap((course) => course.weeks))
}

function teachingWeek(date: Date) {
  const start = semesterStart()
  if (!start) return undefined
  return Math.floor((startOfDay(date).getTime() - start.getTime()) / 86_400_000 / 7) + 1
}

function semesterEnd() {
  const start = semesterStart()
  const lastWeek = maximumWeek()
  return start && lastWeek ? addDays(start, lastWeek * 7 - 1) : undefined
}

function semesterState(date: Date, start: Date, end: Date): SemesterState {
  const selectedDate = startOfDay(date)
  if (selectedDate < start) return 'before'
  if (selectedDate > end) return 'after'
  return 'in-progress'
}

function courseMatchesDate(course: SourceCourse, date: Date) {
  const week = teachingWeek(date)
  if (!week || course.weekday !== date.getDay() || !course.weeks.includes(week)) return false
  return course.parity === 'all' || (course.parity === 'odd' ? week % 2 === 1 : week % 2 === 0)
}

function coursesForDate(date: Date): DisplayCourse[] {
  return courses
    .filter((course) => courseMatchesDate(course, date))
    .sort((left, right) => parseTime(left.start) - parseTime(right.start))
    .map(({ name, start, end, location }) => ({ name, start, end, location: location || '地点待确认' }))
}

function findNextCourse(from: Date, minute = -1): { date: Date; course: DisplayCourse } | undefined {
  const end = semesterEnd()
  if (!end) return undefined
  for (let date = startOfDay(from); date <= end; date = addDays(date, 1)) {
    const threshold = isSameLocalDate(date, from) ? minute : -1
    const course = coursesForDate(date).find((item) => parseTime(item.start) > threshold)
    if (course) return { date, course }
  }
  return undefined
}

function decorate(course: DisplayCourse, options: WidgetOptions): DisplayCourse {
  return {
    ...course,
    name: options.longName ? '现代通信系统原理与网络协议综合设计实践[03]' : course.name,
    location: options.longLocation ? '南湖校区-第一教学楼-信息工程学院实验中心-四阶教室' : course.location,
  }
}

function formatDate(date: Date, mode: ModelMode) {
  const weekday = weekdayNames[date.getDay()]
  if (mode === 'before') return `${weekday} · 学期尚未开始`
  if (mode === 'after') return `${weekday} · 本学期已结束`
  const week = teachingWeek(date)
  return week && week > 0 ? `${weekday} · 第${week}教学周` : weekday
}

function liveModel(options: WidgetOptions): WidgetModel {
  const now = options.now ? new Date(options.now) : new Date()
  const today = startOfDay(now)
  const selectedDate = options.browseDate ? startOfDay(options.browseDate) : today
  const isToday = isSameLocalDate(selectedDate, now)
  const targetDate = isToday ? today : selectedDate
  const start = semesterStart()
  const end = semesterEnd()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  if (!start || !end || courses.length === 0) {
    return { date: targetDate, now: formatTime(now), isToday, mode: 'error', following: [], stateLabel: '课表数据无法读取' }
  }

  const selectedSemesterState = semesterState(targetDate, start, end)
  if (selectedSemesterState === 'before') {
    const next = findNextCourse(start)
    return {
      date: targetDate,
      now: formatTime(now),
      isToday,
      mode: 'before',
      focus: next && decorate(next.course, options),
      focusDate: next?.date,
      following: [],
      stateLabel: '学期尚未开始',
      openingDate: start,
      emptyMessage: next ? undefined : '暂无后续课程',
    }
  }

  if (selectedSemesterState === 'after') {
    return { date: targetDate, now: formatTime(now), isToday, mode: 'after', following: [], stateLabel: '本学期课程已结束', emptyMessage: '暂无后续课程' }
  }

  if (!isToday) {
    const selectedCourses = coursesForDate(targetDate)
    const next = selectedCourses[0] ? undefined : findNextCourse(targetDate)
    const focusCourse = selectedCourses[0] ?? next?.course
    return {
      date: targetDate,
      now: formatTime(now),
      isToday,
      mode: 'browsing',
      focus: focusCourse ? decorate(focusCourse, options) : undefined,
      focusDate: selectedCourses[0] ? targetDate : next?.date,
      following: selectedCourses.slice(1).map((course) => decorate(course, options)),
      stateLabel: selectedCourses.length ? undefined : `${formatMonthDay(targetDate)}无课`,
      emptyMessage: focusCourse ? undefined : '暂无后续课程',
    }
  }

  const todayCourses = coursesForDate(today)
  const activeIndex = todayCourses.findIndex((course) => parseTime(course.start) <= nowMinutes && nowMinutes < parseTime(course.end))
  if (activeIndex >= 0) {
    return { date: today, now: formatTime(now), isToday, mode: 'current', focus: decorate(todayCourses[activeIndex], options), focusDate: today, following: todayCourses.slice(activeIndex + 1).map((course) => decorate(course, options)) }
  }

  const nextTodayIndex = todayCourses.findIndex((course) => parseTime(course.start) > nowMinutes)
  if (nextTodayIndex >= 0) {
    return { date: today, now: formatTime(now), isToday, mode: 'next', focus: decorate(todayCourses[nextTodayIndex], options), focusDate: today, following: todayCourses.slice(nextTodayIndex + 1).map((course) => decorate(course, options)) }
  }

  const next = findNextCourse(today, nowMinutes)
  return {
    date: today,
    now: formatTime(now),
    isToday,
    mode: todayCourses.length ? 'next-date' : 'empty',
    focus: next && decorate(next.course, options),
    focusDate: next?.date,
    following: [],
    stateLabel: todayCourses.length ? '今日课程结束' : '今天无课',
    emptyMessage: next ? undefined : '暂无后续课程',
  }
}

function prototypeCourse(name: string, start: string, fallback: DisplayCourse): DisplayCourse {
  const course = courses.find((item) => item.name === name && item.start === start)
  return course ? { name: course.name, start: course.start, end: course.end, location: course.location || '教学楼 A101' } : fallback
}

function prototypeModel(options: WidgetOptions): WidgetModel {
  const firstClass = prototypeCourse('计算机网络', '08:00', { name: '计算机网络', start: '08:00', end: '09:40', location: '教学楼 A101' })
  const mondayCourses = [
    firstClass,
    prototypeCourse('概率论', '10:00', { name: '概率论', start: '10:00', end: '11:40', location: '教学楼 A101' }),
    prototypeCourse('程序设计基础', '13:30', { name: '程序设计基础', start: '13:30', end: '15:10', location: '教学楼 B203' }),
    prototypeCourse('软件工程', '15:30', { name: '软件工程', start: '15:30', end: '17:10', location: '教学楼 A101' }),
  ]
  let date = prototypeDate
  let now = options.time
  let mode: ModelMode = 'current'
  let focus = mondayCourses[0]
  let following = mondayCourses.slice(1)
  let stateLabel: string | undefined

  if (options.scenario === 'between') { now = options.time === defaultOptions.time ? '09:50' : options.time; mode = 'next'; focus = mondayCourses[1]; following = mondayCourses.slice(2) }
  if (options.scenario === 'ended') { now = options.time === defaultOptions.time ? '18:40' : options.time; mode = 'next-date'; focus = mondayCourses[1]; following = []; stateLabel = '今日课程结束' }
  if (options.scenario === 'empty') { date = addDays(prototypeDate, -1); now = options.time === defaultOptions.time ? '12:20' : options.time; mode = 'empty'; focus = mondayCourses[0]; following = []; stateLabel = '今天无课' }
  if (options.scenario === 'before') { date = new Date(2026, 8, 1); now = options.time === defaultOptions.time ? '08:30' : options.time; mode = 'before'; focus = mondayCourses[0]; following = [] }
  if (options.scenario === 'browsing') { date = addDays(new Date(2026, 8, 22), options.browsingOffset); mode = 'browsing'; focus = mondayCourses[1]; following = mondayCourses.slice(2) }
  return { date, now, isToday: options.scenario !== 'browsing', mode, focus: decorate(focus, options), focusDate: date, following: following.map((course) => decorate(course, options)), stateLabel }
}

function navMarkup(options: WidgetOptions) {
  if (!options.showNav) return ''
  return `<nav class="date-nav" aria-label="日期导航" data-no-drag><button type="button" data-nav="previous" data-no-drag aria-label="前一天">‹</button><button type="button" data-nav="today" data-no-drag>今</button><button type="button" data-nav="next" data-no-drag aria-label="后一天">›</button></nav>`
}

function closeMarkup(options: WidgetOptions) {
  if (!options.closeControl) return ''
  return `<button class="widget-close" type="button" data-hide data-no-drag aria-label="隐藏组件" title="隐藏到托盘">×</button>`
}

function courseDetails(course: DisplayCourse) {
  return `<p class="course-time">${course.start}–${course.end}</p><p class="course-location">${course.location}</p>`
}

function followingMarkup(coursesToShow: DisplayCourse[], total: number) {
  if (!total) return ''
  const visible = coursesToShow.slice(0, 3)
  return `<section class="following" aria-label="后续课程"><p class="section-label">后续课程</p><ol class="timeline">${visible.map((course) => `<li><time>${course.start}</time><span><strong>${course.name}</strong><small>${course.location}</small></span></li>`).join('')}</ol>${total > visible.length ? `<p class="more-courses">还有 ${total - visible.length} 节</p>` : ''}</section>`
}

function countdown(model: WidgetModel) {
  if (!model.focus || model.mode === 'browsing') return ''
  const nowMinutes = parseTime(model.now)
  if (model.mode === 'current') return `<p class="countdown">距下课 ${Math.max(0, parseTime(model.focus.end) - nowMinutes)} 分钟</p>`
  if (model.mode === 'next') return `<p class="countdown">${Math.max(0, parseTime(model.focus.start) - nowMinutes)} 分钟后开始</p>`
  if (model.mode === 'before') return '<p class="countdown">开学后开始上课</p>'
  return ''
}

function focusMarkup(model: WidgetModel) {
  if (!model.focus) return ''
  const isFutureCourse = Boolean(model.focusDate && !isSameLocalDate(model.focusDate, model.date))
  const kicker = model.mode === 'current'
    ? '正在上课'
    : model.mode === 'next'
      ? '下一节课'
      : model.mode === 'before'
        ? '开学后首节'
        : model.mode === 'browsing' && !isFutureCourse
          ? '首节课'
          : '下一次课程'
  const courseDate = model.focusDate && (isFutureCourse || model.mode === 'before')
    ? `<p class="course-date">${formatCourseDate(model.focusDate)}</p>`
    : ''
  return `<section class="focus-course ${model.mode === 'current' ? 'is-current' : ''}"><p class="focus-kicker">${kicker}</p>${courseDate}<h2>${model.focus.name}</h2>${courseDetails(model.focus)}${countdown(model)}</section>`
}

export function createWidget(options: WidgetOptions, onNavigate?: () => void) {
  const model = options.runtime === 'live' ? liveModel(options) : prototypeModel(options)
  const visibleFollowing = ['current', 'next', 'browsing'].includes(model.mode) ? model.following.slice(0, options.followCount) : []
  const title = `${formatMonthDay(model.date)}课表`
  const widget = document.createElement('article')
  widget.className = `course-widget theme-${options.theme}`
  widget.style.setProperty('--widget-width', `${options.width}px`)
  widget.style.setProperty('--widget-scale', String(options.scale))
  widget.innerHTML = `
    <header class="widget-header">
      <div class="widget-drag-surface ${options.dragRegion ? 'is-desktop-drag' : ''}">
        <div class="widget-heading"><div class="title-row"><p class="widget-title">${title}</p>${model.isToday ? '<span class="today-badge">今日</span>' : ''}</div><p class="date-line">${formatDate(model.date, model.mode)}</p></div>
        <div class="header-right"><div class="header-meta"><time class="now-time">${model.now}</time>${closeMarkup(options)}</div>${navMarkup(options)}</div>
      </div>
    </header>
    <div class="widget-body">
    ${model.stateLabel ? `<p class="state-label">${model.stateLabel}</p>` : ''}
    ${model.openingDate ? `<p class="opening-date">${formatMonthDay(model.openingDate)}开学</p>` : ''}
    ${focusMarkup(model)}
    ${model.emptyMessage ? `<p class="empty-state">${model.emptyMessage}</p>` : ''}
    ${followingMarkup(visibleFollowing, model.following.length)}
    </div>
  `

  widget.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((button) => button.addEventListener('click', () => {
    const direction = button.dataset.nav
    if (options.runtime === 'live') {
      if (direction === 'today') options.browseDate = undefined
      else {
        const today = startOfDay(options.now ?? new Date())
        const base = options.browseDate ? startOfDay(options.browseDate) : today
        const nextDate = addDays(base, direction === 'next' ? 1 : -1)
        options.browseDate = isSameLocalDate(nextDate, today) ? undefined : nextDate
      }
    } else if (direction === 'today') options.scenario = 'current'
    else { options.scenario = 'browsing'; options.browsingOffset += direction === 'next' ? 1 : -1 }
    onNavigate?.()
  }))

  let hideRequested = false
  widget.querySelector<HTMLButtonElement>('[data-hide]')?.addEventListener('click', () => {
    if (hideRequested || !isTauri()) return
    hideRequested = true
    void getCurrentWindow().hide()
      .then(() => emit('widget:visibility-changed'))
      .catch((error: unknown) => {
        hideRequested = false
        console.error('[widget-close] hide failed', error)
      })
  })

  const dragSurface = widget.querySelector<HTMLElement>('.widget-drag-surface')
  if (dragSurface && options.dragRegion && isTauri()) {
    dragSurface.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target : null
      const excluded = target?.closest('button, a, input, select, textarea, [data-no-drag], .date-nav, .widget-close')
      const draggable = event.button === 0 && !excluded
      if (import.meta.env.DEV) console.debug('[widget-drag]', { target: target?.tagName.toLowerCase() ?? 'unknown', draggable, startDraggingCalled: draggable })
      if (!draggable) return
      event.preventDefault()
      event.stopPropagation()
      void getCurrentWindow().startDragging().catch((error: unknown) => console.error('[widget-drag] startDragging failed', error))
    })
  }
  return widget
}
