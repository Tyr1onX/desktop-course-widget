import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ImportCourse, ImportDraft } from './import-draft'
import { parseWeeksText, refreshImportDraftSummary, validateImportCourse, validateImportDraft, weeksToText } from './import-review'
import { requestSettingsWindowClose } from './window-close-behavior'
import scheduleData from './data/schedule.json'
import './settings.css'

type Parity = 'all' | 'odd' | 'even'
type Surface = 'course' | 'schedule' | 'import' | 'times' | 'data' | 'help' | 'about' | null

type LessonTime = {
  section: number
  start: string
  end: string
}

type AppSettings = {
  schemaVersion: number
  onboardingCompleted: boolean
  lessonTimes: LessonTime[]
  equalDuration: boolean
}

type CatalogCourse = {
  id: string
  name: string
  color: string
  teacher: string
  weekday: number
  start: string
  end: string
  location: string
  weeks: number[]
  parity: Parity
}

type CatalogSchedule = {
  id: string
  name: string
  semesterStart: string
  semesterEnd?: string | null
  courses: CatalogCourse[]
}

type ScheduleSummary = {
  id: string
  name: string
  semesterStart: string
  semesterEnd?: string | null
  courseCount: number
  active: boolean
}

type DraftSlot = {
  key: string
  weekday: number
  startSection: number
  endSection: number
  startWeek: number
  endWeek: number
  parity: Parity
  customWeeks: boolean
  selectedWeeks: number[]
  location: string
  teacher: string
}

type CourseDraft = {
  courseId?: string
  name: string
  color: string
  slots: DraftSlot[]
}

type ScheduleDraft = {
  id: string
  name: string
  semesterStart: string
  totalWeeks: number
  courseCount: number
  active: boolean
}

type SaveCourseRequest = {
  courseId?: string
  name: string
  color: string
  slots: Array<{
    weekday: number
    start: string
    end: string
    weeks: number[]
    parity: Parity
    location: string
    teacher: string
  }>
}

type PositionedCourse = {
  course: CatalogCourse
  startIndex: number
  endIndex: number
  lane: number
  laneCount: number
}

const desktopRuntime = '__TAURI_INTERNALS__' in window
const plugin = (command: string) => `plugin:schedule-catalog|${command}`
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const palette = ['#CFE1FF', '#D8EBCF', '#F8D8D2', '#E5D9F7', '#F9E3B7', '#CFE9E8', '#F2D6E6', '#D9E1F2', '#E4E7C9', '#F4DCC5']
const rowHeight = 66
const completeTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const defaultLessonTimes: LessonTime[] = [
  { section: 1, start: '08:00', end: '08:45' },
  { section: 2, start: '08:55', end: '09:40' },
  { section: 3, start: '10:00', end: '10:45' },
  { section: 4, start: '10:55', end: '11:40' },
  { section: 5, start: '13:30', end: '14:15' },
  { section: 6, start: '14:25', end: '15:10' },
  { section: 7, start: '15:30', end: '16:15' },
  { section: 8, start: '16:25', end: '17:10' },
  { section: 9, start: '18:00', end: '18:45' },
  { section: 10, start: '18:55', end: '19:40' },
]

const app = document.querySelector<HTMLDivElement>('#app')!

let schedule = browserSchedule()
let summaries: ScheduleSummary[] = [summaryFromSchedule(schedule, true)]
let settings: AppSettings = {
  schemaVersion: 1,
  onboardingCompleted: true,
  lessonTimes: structuredClone(defaultLessonTimes),
  equalDuration: false,
}
let currentWeek = initialWeek(schedule)
let surface: Surface = null
let menuOpen = false
let scheduleMenuOpen = false
let selectedCourseId: string | null = null
let courseDraft: CourseDraft | null = null
let initialDraftSnapshot = ''
let scheduleDraft: ScheduleDraft | null = null
let initialScheduleDraftSnapshot = ''
let importDraft: ImportDraft | null = null
let importNameDraft = ''
let importFirstWeekDraft = ''
let expandedImportCourseIndex = 0
let importRequestId = ''
let importCreatePending = false
let surfaceMessage = ''
let autostartEnabled = false
let timeDraft = structuredClone(settings.lessonTimes)
let timeEqualDuration = settings.equalDuration

function browserSchedule(): CatalogSchedule {
  const source = scheduleData as {
    semesterStart: string
    semesterEnd?: string
    courses: Array<Omit<CatalogCourse, 'id' | 'color'>>
  }
  const ids = new Map<string, string>()
  return {
    id: 'browser-sample',
    name: '示例课表',
    semesterStart: source.semesterStart,
    semesterEnd: source.semesterEnd,
    courses: source.courses.map((course, index) => {
      const key = course.name.trim()
      const id = ids.get(key) ?? `sample-course-${ids.size + 1}`
      ids.set(key, id)
      return { ...course, id, color: palette[index % palette.length] }
    }),
  }
}

function summaryFromSchedule(value: CatalogSchedule, active: boolean): ScheduleSummary {
  return {
    id: value.id,
    name: value.name,
    semesterStart: value.semesterStart,
    semesterEnd: value.semesterEnd,
    courseCount: new Set(value.courses.map((course) => course.id)).size,
    active,
  }
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  result.setDate(result.getDate() + days)
  return result
}

function dateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialWeek(value: CatalogSchedule): number {
  const start = parseLocalDate(value.semesterStart)
  const now = new Date()
  const week = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - start.getTime()) / 604_800_000) + 1
  return clamp(week, 1, maximumWeek(value))
}

function courseMaximumWeek(value: CatalogSchedule): number {
  return Math.max(1, ...value.courses.flatMap((course) => course.weeks))
}

function calendarWeekCount(semesterStart: string, semesterEnd?: string | null): number | null {
  if (!semesterEnd) return null
  const start = parseLocalDate(semesterStart)
  const end = parseLocalDate(semesterEnd)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (!Number.isFinite(days) || days <= 0) return null
  return clamp(Math.ceil(days / 7), 1, 30)
}

function maximumWeek(value: CatalogSchedule): number {
  return Math.max(courseMaximumWeek(value), calendarWeekCount(value.semesterStart, value.semesterEnd) ?? 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function isValidClockTime(value: string): boolean {
  return completeTimePattern.test(value)
}

function timeToMinutes(value: string): number {
  if (!isValidClockTime(value)) return Number.NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function lessonIndexForStart(value: string): number {
  const exact = settings.lessonTimes.findIndex((item) => item.start === value)
  if (exact >= 0) return exact
  const target = timeToMinutes(value)
  const next = settings.lessonTimes.findIndex((item) => timeToMinutes(item.start) >= target)
  return next >= 0 ? next : settings.lessonTimes.length - 1
}

function lessonIndexForEnd(value: string): number {
  const exact = settings.lessonTimes.findIndex((item) => item.end === value)
  if (exact >= 0) return exact
  const target = timeToMinutes(value)
  let match = 0
  settings.lessonTimes.forEach((item, index) => {
    if (timeToMinutes(item.end) <= target) match = index
  })
  return match
}

function weekDates(): Date[] {
  const start = addDays(parseLocalDate(schedule.semesterStart), (currentWeek - 1) * 7)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

function isCourseVisible(course: CatalogCourse): boolean {
  if (!course.weeks.includes(currentWeek)) return false
  if (course.parity === 'odd' && currentWeek % 2 === 0) return false
  if (course.parity === 'even' && currentWeek % 2 === 1) return false
  return true
}

function positionCourses(courses: CatalogCourse[]): PositionedCourse[] {
  const source = courses
    .map((course) => ({
      course,
      startIndex: lessonIndexForStart(course.start),
      endIndex: lessonIndexForEnd(course.end),
    }))
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex)
  const result: PositionedCourse[] = []
  let cursor = 0

  while (cursor < source.length) {
    const cluster = [source[cursor]]
    let clusterEnd = source[cursor].endIndex
    let nextIndex = cursor + 1
    while (nextIndex < source.length && source[nextIndex].startIndex <= clusterEnd) {
      cluster.push(source[nextIndex])
      clusterEnd = Math.max(clusterEnd, source[nextIndex].endIndex)
      nextIndex += 1
    }

    const laneEnds: number[] = []
    const assigned = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end < item.startIndex)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = item.endIndex
      return { ...item, lane }
    })
    const laneCount = Math.max(1, laneEnds.length)
    result.push(...assigned.map((item) => ({ ...item, laneCount })))
    cursor = nextIndex
  }

  return result
}

function render(): void {
  app.innerHTML = `
    <main class="settings-app${surface ? ' has-surface' : ''}">
      <header class="schedule-toolbar">
        <div class="schedule-selector-wrap">
          <button
            class="schedule-selector"
            type="button"
            data-action="toggle-schedule-menu"
            aria-label="切换课表，当前为 ${escapeHtml(schedule.name)}"
            aria-expanded="${scheduleMenuOpen}"
          >
            <span class="schedule-selector-copy">
              <strong title="${escapeHtml(schedule.name)}">${escapeHtml(schedule.name)}</strong>
            </span>
            <span class="schedule-selector-chevron" aria-hidden="true"></span>
          </button>
          ${scheduleMenuOpen ? scheduleMenuMarkup() : ''}
        </div>
        <div class="week-switcher" aria-label="教学周切换">
          <button class="icon-button week-button" type="button" data-action="previous-week" aria-label="上一教学周">‹</button>
          <span class="week-label">第 ${currentWeek} 教学周</span>
          <button class="icon-button week-button" type="button" data-action="next-week" aria-label="下一教学周">›</button>
        </div>
        <div class="toolbar-actions">
          <button class="icon-button toolbar-button" type="button" data-action="add-course" aria-label="新增课程">＋</button>
          <button class="icon-button toolbar-button" type="button" data-action="toggle-menu" aria-label="更多设置" aria-expanded="${menuOpen}">⋯</button>
          ${menuOpen ? menuMarkup() : ''}
        </div>
      </header>
      <section class="schedule-stage">
        ${scheduleMarkup()}
        ${surface ? '<div class="schedule-dimmer" aria-hidden="true"></div>' : ''}
        ${surfaceMarkup()}
      </section>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    </main>
  `
  bindEvents()
}

function menuMarkup(): string {
  return `
    <div class="more-menu" role="menu">
      <button type="button" role="menuitem" data-open-surface="times"><span>作息时间</span></button>
      <div class="menu-separator"></div>
      <button type="button" role="menuitemcheckbox" aria-checked="${autostartEnabled}" data-action="toggle-autostart">
        <span>开机启动</span><span class="menu-check">${autostartEnabled ? '✓' : ''}</span>
      </button>
      <div class="menu-separator"></div>
      <button type="button" role="menuitem" data-open-surface="help"><span>使用帮助</span></button>
      <button type="button" role="menuitem" data-open-surface="about"><span>关于</span></button>
    </div>
  `
}

function scheduleMenuMarkup(): string {
  const items = summaries.map((item) => `
    <button
      class="schedule-menu-item${item.active ? ' is-active' : ''}"
      type="button"
      role="menuitemradio"
      aria-checked="${item.active}"
      ${item.active ? 'data-action="close-schedule-menu"' : `data-activate-schedule="${escapeHtml(item.id)}"`}
    >
      <span class="schedule-menu-item-copy">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.courseCount} 门课程 · ${escapeHtml(item.semesterStart)}</span>
      </span>
      <span class="schedule-menu-check">${item.active ? '✓' : ''}</span>
    </button>
  `).join('')
  return `
    <div class="schedule-menu" role="menu" aria-label="切换课表">
      <header><strong>切换课表</strong><span>${summaries.length} 份</span></header>
      <div class="schedule-menu-list">${items}</div>
      <div class="menu-separator"></div>
      <button class="schedule-menu-command" type="button" role="menuitem" data-open-surface="import">导入新课表</button>
      <button class="schedule-menu-command" type="button" role="menuitem" data-open-surface="data">管理课表与数据</button>
    </div>
  `
}

function scheduleMarkup(): string {
  const dates = weekDates()
  const today = dateKey(new Date())
  const month = dates[0].getMonth() + 1
  const bodyHeight = settings.lessonTimes.length * rowHeight
  const visible = schedule.courses.filter(isCourseVisible)

  const headers = dates.map((date, index) => {
    const current = dateKey(date) === today
    return `
      <div class="day-heading${current ? ' is-today' : ''}">
        <span>${weekdays[index]}</span>
        <strong>${date.getDate()}</strong>
      </div>
    `
  }).join('')

  const timeLabels = settings.lessonTimes.map((item) => `
    <div class="lesson-label" style="height:${rowHeight}px">
      <strong>${item.section}</strong>
      <span>${item.start}</span>
    </div>
  `).join('')

  const dayColumns = Array.from({ length: 7 }, (_, dayIndex) => {
    const dayCourses = visible.filter((course) => course.weekday === dayIndex + 1)
    const cards = positionCourses(dayCourses).map(({ course, startIndex, endIndex, lane, laneCount }) => {
      const height = (endIndex - startIndex + 1) * rowHeight - 6
      const top = startIndex * rowHeight + 3
      const width = 100 / laneCount
      const singleLesson = startIndex === endIndex
      const selected = selectedCourseId === course.id
      return `
        <button
          class="course-card${selected ? ' is-selected' : ''}"
          type="button"
          data-course-id="${escapeHtml(course.id)}"
          style="--course-color:${escapeHtml(course.color)};top:${top}px;height:${height}px;left:calc(${lane * width}% + 3px);width:calc(${width}% - 6px)"
          aria-label="编辑 ${escapeHtml(course.name)}"
        >
          <strong>${escapeHtml(course.name)}</strong>
          ${singleLesson || !course.location ? '' : `<span>${escapeHtml(course.location)}</span>`}
        </button>
      `
    }).join('')
    return `<div class="day-column" style="height:${bodyHeight}px">${cards}</div>`
  }).join('')

  const empty = visible.length === 0
    ? `<div class="week-empty">第 ${currentWeek} 教学周没有课程</div>`
    : ''

  return `
    <div class="schedule-scroll">
      <div class="schedule-head">
        <div class="month-heading"><strong>${month}</strong><span>月</span></div>
        ${headers}
      </div>
      <div class="schedule-body" style="--lesson-count:${settings.lessonTimes.length};--row-height:${rowHeight}px">
        <div class="lesson-column">${timeLabels}</div>
        ${dayColumns}
        ${empty}
      </div>
    </div>
  `
}

function surfaceMarkup(): string {
  if (!surface) return ''
  if (surface === 'course') return courseSurfaceMarkup()
  if (surface === 'schedule') return scheduleSurfaceMarkup()
  if (surface === 'import') return importSurfaceMarkup()
  if (surface === 'times') return timesSurfaceMarkup()
  if (surface === 'data') return dataSurfaceMarkup()
  if (surface === 'help') return helpSurfaceMarkup()
  return aboutSurfaceMarkup()
}

function surfaceShell(title: string, content: string, wide = false): string {
  return `
    <aside class="side-surface${wide ? ' side-surface--wide' : ''}" aria-label="${escapeHtml(title)}">
      <header class="surface-header">
        <h2>${escapeHtml(title)}</h2>
        <button class="icon-button surface-close" type="button" data-action="close-surface" aria-label="关闭">×</button>
      </header>
      ${content}
    </aside>
  `
}

function courseSurfaceMarkup(): string {
  if (!courseDraft) return ''
  const editing = Boolean(courseDraft.courseId)
  const maxWeek = Math.max(maximumWeek(schedule), 20)
  const slots = courseDraft.slots.map((slot, index) => slotMarkup(slot, index, maxWeek)).join('')
  return surfaceShell(editing ? '编辑课程' : '新增课程', `
    <div class="surface-scroll course-form">
      <label class="field field--full">
        <span>课程名称</span>
        <input id="course-name" value="${escapeHtml(courseDraft.name)}" maxlength="160" placeholder="输入课程名称" />
      </label>
      <fieldset class="color-field">
        <legend>课程颜色</legend>
        <div class="color-options">
          ${palette.map((color) => `<button class="color-swatch${courseDraft?.color === color ? ' is-active' : ''}" type="button" data-color="${color}" style="--swatch:${color}" aria-label="选择颜色 ${color}"></button>`).join('')}
        </div>
      </fieldset>
      <div class="section-heading">
        <div><h3>上课时间</h3><p>一门课程可以添加多个时间段。</p></div>
      </div>
      <div class="slot-list">${slots}</div>
      <button class="text-button add-slot" type="button" data-action="add-slot">＋ 添加时间段</button>
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions">
      ${editing ? '<button class="danger-button" type="button" data-action="delete-course">删除课程</button>' : '<span></span>'}
      <div class="action-group">
        <button class="secondary-button" type="button" data-action="cancel-course">取消</button>
        <button class="primary-button" type="button" data-action="save-course">${editing ? '保存修改' : '保存课程'}</button>
      </div>
    </footer>
  `, true)
}

function slotMarkup(slot: DraftSlot, index: number, maxWeek: number): string {
  const lessonOptions = settings.lessonTimes.map((item) => `<option value="${item.section}">${item.section}</option>`).join('')
  const weekButtons = Array.from({ length: maxWeek }, (_, offset) => offset + 1).map((week) => `
    <button class="week-chip${slot.selectedWeeks.includes(week) ? ' is-selected' : ''}" type="button" data-slot-week="${slot.key}:${week}">${week}</button>
  `).join('')
  return `
    <section class="slot-card" data-slot-key="${slot.key}">
      <header>
        <strong>时间段 ${index + 1}</strong>
        ${courseDraft && courseDraft.slots.length > 1 ? `<button class="slot-remove" type="button" data-remove-slot="${slot.key}" aria-label="删除时间段 ${index + 1}">×</button>` : ''}
      </header>
      <div class="form-grid">
        <label class="field">
          <span>星期</span>
          <select data-slot-field="weekday" data-slot="${slot.key}">
            ${weekdayLabels.map((label, day) => `<option value="${day + 1}"${slot.weekday === day + 1 ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <div class="field section-range">
          <span>节次</span>
          <div>
            <select data-slot-field="startSection" data-slot="${slot.key}">${lessonOptions.replace(`value="${slot.startSection}"`, `value="${slot.startSection}" selected`)}</select>
            <span>至</span>
            <select data-slot-field="endSection" data-slot="${slot.key}">${lessonOptions.replace(`value="${slot.endSection}"`, `value="${slot.endSection}" selected`)}</select>
          </div>
        </div>
        <label class="field">
          <span>起始周</span>
          <input type="number" min="1" max="30" value="${slot.startWeek}" data-slot-field="startWeek" data-slot="${slot.key}" />
        </label>
        <label class="field">
          <span>结束周</span>
          <input type="number" min="1" max="30" value="${slot.endWeek}" data-slot-field="endWeek" data-slot="${slot.key}" />
        </label>
        <label class="field field--full">
          <span>重复</span>
          <select data-slot-field="parity" data-slot="${slot.key}">
            <option value="all"${slot.parity === 'all' ? ' selected' : ''}>每周</option>
            <option value="odd"${slot.parity === 'odd' ? ' selected' : ''}>单周</option>
            <option value="even"${slot.parity === 'even' ? ' selected' : ''}>双周</option>
          </select>
        </label>
        <label class="field field--full">
          <span>地点</span>
          <input value="${escapeHtml(slot.location)}" data-slot-field="location" data-slot="${slot.key}" placeholder="选填" maxlength="160" />
        </label>
        <label class="field field--full">
          <span>老师</span>
          <input value="${escapeHtml(slot.teacher)}" data-slot-field="teacher" data-slot="${slot.key}" placeholder="选填" maxlength="160" />
        </label>
      </div>
      <button class="custom-weeks-toggle" type="button" data-toggle-weeks="${slot.key}">${slot.customWeeks ? '收起自定义周次' : '展开自定义周次'}</button>
      ${slot.customWeeks ? `
        <div class="custom-weeks">
          <div class="week-chip-grid">${weekButtons}</div>
          <div class="custom-week-actions">
            <button type="button" data-week-action="all:${slot.key}">全选</button>
            <button type="button" data-week-action="clear:${slot.key}">清空</button>
          </div>
        </div>
      ` : ''}
    </section>
  `
}

function importCourseReviewMarkup(course: ImportCourse, index: number): string {
  const issues = validateImportCourse(course, settings.lessonTimes.length)
  const weekday = weekdayLabels[course.weekday - 1] ?? '星期待确认'
  const sectionText = course.startSection === course.endSection
    ? `第 ${course.startSection} 节`
    : `第 ${course.startSection}–${course.endSection} 节`
  const weekText = weeksToText(course.weeks)
  const lessonOptions = settings.lessonTimes.map((item) => `<option value="${item.section}">${item.section}</option>`).join('')
  const startOptions = lessonOptions.replace(`value="${course.startSection}"`, `value="${course.startSection}" selected`)
  const endOptions = lessonOptions.replace(`value="${course.endSection}"`, `value="${course.endSection}" selected`)
  return `
    <details class="import-course-review${issues.length ? ' has-issues' : ''}" data-import-course-details="${index}"${expandedImportCourseIndex === index ? ' open' : ''}>
      <summary>
        <span class="import-course-copy">
          <strong>${escapeHtml(course.name.trim() || `未命名课程 ${index + 1}`)}</strong>
          <small>${escapeHtml(`${weekday} · ${sectionText} · ${weekText || '周次待确认'}周`)}</small>
        </span>
        <span class="import-course-state">${issues.length ? `${issues.length} 项待确认` : '信息完整'}</span>
      </summary>
      <div class="import-course-review-grid">
        <label class="field field--full">
          <span>课程名称</span>
          <input value="${escapeHtml(course.name)}" maxlength="160" data-import-course="${index}" data-import-field="name" />
        </label>
        <label class="field">
          <span>星期</span>
          <select data-import-course="${index}" data-import-field="weekday">
            ${weekdayLabels.map((label, offset) => `<option value="${offset + 1}"${course.weekday === offset + 1 ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>重复</span>
          <select data-import-course="${index}" data-import-field="parity">
            <option value="all"${course.parity === 'all' ? ' selected' : ''}>每周</option>
            <option value="odd"${course.parity === 'odd' ? ' selected' : ''}>单周</option>
            <option value="even"${course.parity === 'even' ? ' selected' : ''}>双周</option>
          </select>
        </label>
        <label class="field">
          <span>开始节次</span>
          <select data-import-course="${index}" data-import-field="startSection">${startOptions}</select>
        </label>
        <label class="field">
          <span>结束节次</span>
          <select data-import-course="${index}" data-import-field="endSection">${endOptions}</select>
        </label>
        <label class="field field--full">
          <span>教学周</span>
          <input value="${escapeHtml(weekText)}" placeholder="例如 1-8, 10-16" data-import-course="${index}" data-import-field="weeks" />
        </label>
        <label class="field">
          <span>地点</span>
          <input value="${escapeHtml(course.location ?? '')}" maxlength="160" placeholder="选填" data-import-course="${index}" data-import-field="location" />
        </label>
        <label class="field">
          <span>老师</span>
          <input value="${escapeHtml(course.teacher ?? '')}" maxlength="160" placeholder="选填" data-import-course="${index}" data-import-field="teacher" />
        </label>
      </div>
      ${issues.length ? `<ul class="import-course-issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : ''}
    </details>
  `
}

function importSurfaceMarkup(): string {
  const draft = importDraft
  const issueCount = draft
    ? draft.courses.reduce((total, course) => total + validateImportCourse(course, settings.lessonTimes.length).length, 0)
    : 0
  const reviewCards = draft?.courses.map(importCourseReviewMarkup).join('') ?? ''
  return surfaceShell('检查并导入课表', `
    <div class="surface-scroll simple-surface import-review-surface">
      <div class="surface-intro">
        <h3 class="import-step-title">1 · 选择文件</h3>
        <p>先逐项检查识别结果，再创建新课表；已有课表不会被覆盖。</p>
      </div>
      <button class="import-picker" type="button" data-action="choose-excel">
        <strong>${escapeHtml(draft?.sourceName ?? '选择一份 .xlsx 课表')}</strong>
        <span>${desktopRuntime ? '文件只在本机解析，不会上传' : '浏览器预览中不会读取本机文件'}</span>
      </button>
      ${draft ? `
        <div class="import-summary">
          <div><span>课程安排</span><strong>${draft.summary.arrangements} 项</strong></div>
          <div><span>最高教学周</span><strong>${draft.summary.highestWeek} 周</strong></div>
          <div><span>待确认</span><strong>${issueCount} 项</strong></div>
        </div>
        <div class="import-basics">
          <label class="field field--full"><span>课表名称</span><input id="import-name" value="${escapeHtml(importNameDraft || draft.suggestedName)}" /></label>
          <label class="field field--full"><span>第一周星期一</span><input id="import-first-week" type="date" value="${escapeHtml(importFirstWeekDraft || schedule.semesterStart)}" /></label>
        </div>
        ${draft.warnings.length ? `
          <section class="import-parser-warnings">
            <strong>解析提示</strong>
            <ul>${draft.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
          </section>
        ` : ''}
        <div class="import-review-heading">
          <div><h3>2 · 检查解析结果</h3><p>展开课程可修改星期、节次、周次、地点和老师。</p></div>
          <span>${draft.courses.length} 项</span>
        </div>
        <div class="import-review-list">${reviewCards}</div>
      ` : ''}
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions surface-actions--end">
      <span class="import-step-label">3 · 确认创建</span>
      <button class="primary-button" type="button" data-action="create-imported-schedule"${draft && issueCount === 0 && !importCreatePending ? '' : ' disabled'}>确认并创建课表</button>
    </footer>
  `, true)
}

function timesSurfaceMarkup(): string {
  const rows = timeDraft.map((item) => `
    <div class="time-row">
      <strong>${item.section}</strong>
      <label><span>开始</span><input type="time" min="00:00" max="23:59" step="60" value="${item.start}" data-time-start="${item.section}" /></label>
      <label><span>结束</span><input type="time" min="00:00" max="23:59" step="60" value="${item.end}" data-time-end="${item.section}" /></label>
    </div>
  `).join('')
  return surfaceShell('作息时间', `
    <div class="surface-scroll simple-surface">
      <div class="surface-intro"><h3>逐节设置时间</h3><p>课表显示多少节由这里的节次数量决定。</p></div>
      <label class="switch-row"><span>每节课时长相同</span><input id="equal-duration" type="checkbox"${timeEqualDuration ? ' checked' : ''} /></label>
      <div class="time-list">${rows}</div>
      <div class="inline-actions">
        <button class="secondary-button" type="button" data-action="add-lesson">＋ 添加节次</button>
        <button class="secondary-button" type="button" data-action="remove-lesson"${timeDraft.length <= 1 ? ' disabled' : ''}>删除末节</button>
      </div>
      <button class="text-button" type="button" data-action="restore-times">恢复默认作息</button>
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions surface-actions--end"><button class="primary-button" type="button" data-action="save-times">保存作息时间</button></footer>
  `)
}

function scheduleSurfaceMarkup(): string {
  if (!scheduleDraft) return ''
  const minimumWeeks = scheduleDraft.id === schedule.id ? courseMaximumWeek(schedule) : 1
  return surfaceShell('编辑课表', `
    <div class="surface-scroll simple-surface schedule-editor">
      <div class="surface-intro">
        <h3>课表信息</h3>
        <p>教学周会根据第一周星期一自动计算，修改后不会改变课程本身的周次。</p>
      </div>
      <div class="schedule-editor-form">
        <label class="field field--full">
          <span>课表名称</span>
          <input id="schedule-name" value="${escapeHtml(scheduleDraft.name)}" maxlength="80" placeholder="输入课表名称" />
        </label>
        <label class="field">
          <span>第一周星期一</span>
          <input id="schedule-semester-start" type="date" value="${escapeHtml(scheduleDraft.semesterStart)}" />
        </label>
        <label class="field">
          <span>学期总周数</span>
          <input id="schedule-total-weeks" type="number" min="${minimumWeeks}" max="30" value="${scheduleDraft.totalWeeks}" />
        </label>
      </div>
      <div class="schedule-metadata">
        <div><span>课程数量</span><strong>${scheduleDraft.courseCount} 门</strong></div>
        <div><span>当前状态</span><strong>${scheduleDraft.active ? '正在使用' : '未启用'}</strong></div>
      </div>
      ${minimumWeeks > 1 ? `<p class="editor-note">该课表的课程已使用到第 ${minimumWeeks} 周，因此总周数不能更少。</p>` : ''}
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions">
      <button class="danger-button" type="button" data-action="delete-edited-schedule"${summaries.length <= 1 ? ' disabled title="至少保留一份课表"' : ''}>删除课表</button>
      <div class="action-group">
        <button class="secondary-button" type="button" data-action="cancel-schedule">取消</button>
        <button class="primary-button" type="button" data-action="save-schedule">保存修改</button>
      </div>
    </footer>
  `)
}

function dataSurfaceMarkup(): string {
  const items = summaries.map((item) => {
    const weeks = calendarWeekCount(item.semesterStart, item.semesterEnd)
    return `
      <article class="schedule-record${item.active ? ' is-active' : ''}">
        <div class="record-copy">
          <div class="record-title"><strong>${escapeHtml(item.name)}</strong>${item.active ? '<span>当前</span>' : ''}</div>
          <p>${escapeHtml(item.semesterStart)} · ${weeks ? `${weeks} 周 · ` : ''}${item.courseCount} 门课程</p>
        </div>
        <div class="record-actions">
          ${item.active ? '' : `<button type="button" data-activate-schedule="${escapeHtml(item.id)}">设为当前</button>`}
          <button type="button" data-edit-schedule="${escapeHtml(item.id)}">编辑</button>
          <button class="record-delete" type="button" data-delete-schedule="${escapeHtml(item.id)}"${summaries.length <= 1 ? ' disabled title="至少保留一份课表"' : ''}>删除</button>
        </div>
      </article>
    `
  }).join('')
  return surfaceShell('课表与数据', `
    <div class="surface-scroll simple-surface">
      <div class="schedule-records">${items}</div>
      <div class="data-card">
        <h3>本地数据</h3>
        <button class="secondary-button" type="button" data-action="open-data-location">打开数据位置</button>
      </div>
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
  `)
}
function helpSurfaceMarkup(): string {
  return surfaceShell('使用帮助', `
    <div class="surface-scroll simple-surface help-list">
      <section><h3>查看其他教学周</h3><p>点击顶部左右箭头切换教学周。星期栏会同步显示对应日期。</p></section>
      <section><h3>新增或修改课程</h3><p>点击右上角“＋”新增课程；点击课程块后可在右侧修改多个上课时间段。</p></section>
      <section><h3>管理多份课表</h3><p>点击左上角当前课表名称即可快速切换；也可进入“课表与数据”删除课表。</p></section>
      <section><h3>关闭桌面组件</h3><p>关闭组件只会隐藏到系统托盘；右键托盘图标可以重新显示或退出。</p></section>
    </div>
  `)
}

function aboutSurfaceMarkup(): string {
  return surfaceShell('关于', `
    <div class="surface-scroll simple-surface about-panel">
      <div class="about-icon">课</div>
      <h3>桌面课表</h3>
      <p>Windows 本地桌面课表组件</p>
      <span>版本 0.2.0</span>
      <p class="about-note">课表数据仅保存在本机，不会上传到服务器。</p>
    </div>
  `)
}

function bindEvents(): void {
  document.querySelector('[data-action="toggle-menu"]')?.addEventListener('click', () => {
    scheduleMenuOpen = false
    menuOpen = !menuOpen
    render()
  })
  document.querySelector('[data-action="toggle-schedule-menu"]')?.addEventListener('click', () => {
    menuOpen = false
    scheduleMenuOpen = !scheduleMenuOpen
    render()
  })
  document.querySelector('[data-action="close-schedule-menu"]')?.addEventListener('click', () => {
    scheduleMenuOpen = false
    render()
  })
  document.querySelector('[data-action="add-course"]')?.addEventListener('click', () => openNewCourse())
  document.querySelector('[data-action="previous-week"]')?.addEventListener('click', () => changeWeek(-1))
  document.querySelector('[data-action="next-week"]')?.addEventListener('click', () => changeWeek(1))
  document.querySelector<HTMLElement>('.schedule-scroll')?.addEventListener('click', (event) => {
    if (scheduleMenuOpen || menuOpen) {
      scheduleMenuOpen = false
      menuOpen = false
      render()
      return
    }
    if (!surface) return
    const target = event.target as HTMLElement
    if (target.closest('[data-course-id]')) return
    closeSurface('backdrop')
  })
  document.querySelector('[data-action="close-surface"]')?.addEventListener('click', () => closeSurface('explicit'))

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-surface]')) {
    button.addEventListener('click', () => openSurface(button.dataset.openSurface as Exclude<Surface, 'course' | null>))
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-course-id]')) {
    button.addEventListener('click', () => openExistingCourse(button.dataset.courseId ?? ''))
  }

  document.querySelector('[data-action="toggle-autostart"]')?.addEventListener('click', () => void toggleAutostart())
  bindCourseEvents()
  bindScheduleEvents()
  bindImportEvents()
  bindTimeEvents()
  bindDataEvents()
}

function changeWeek(delta: number): void {
  if (!canLeaveCourse('切换教学周')) return
  scheduleMenuOpen = false
  menuOpen = false
  currentWeek = clamp(currentWeek + delta, 1, maximumWeek(schedule))
  selectedCourseId = null
  render()
}

function openSurface(next: Exclude<Surface, 'course' | null>): void {
  if (!canLeaveCourse('打开其他设置')) return
  surface = next
  menuOpen = false
  scheduleMenuOpen = false
  selectedCourseId = null
  surfaceMessage = ''
  if (next === 'times') {
    timeDraft = structuredClone(settings.lessonTimes)
    timeEqualDuration = settings.equalDuration
  }
  render()
}

function closeSurface(reason: 'backdrop' | 'explicit'): void {
  if (hasUnsavedChanges()) {
    if (reason === 'backdrop') return
    if (!window.confirm('放弃未保存的修改？')) return
  }
  surface = null
  selectedCourseId = null
  courseDraft = null
  initialDraftSnapshot = ''
  scheduleDraft = null
  initialScheduleDraftSnapshot = ''
  surfaceMessage = ''
  render()
}

function canLeaveCourse(action: string): boolean {
  if (!hasUnsavedChanges()) return true
  return window.confirm(`${action}会放弃当前未保存的修改，是否继续？`)
}

function hasUnsavedChanges(): boolean {
  return draftDirty() || scheduleDraftDirty()
}

function draftDirty(): boolean {
  return surface === 'course' && Boolean(courseDraft && JSON.stringify(courseDraft) !== initialDraftSnapshot)
}

function scheduleDraftDirty(): boolean {
  if (surface !== 'schedule' || !scheduleDraft) return false
  const currentDraft = {
    ...scheduleDraft,
    name: document.querySelector<HTMLInputElement>('#schedule-name')?.value ?? scheduleDraft.name,
    semesterStart: document.querySelector<HTMLInputElement>('#schedule-semester-start')?.value ?? scheduleDraft.semesterStart,
    totalWeeks: Number(document.querySelector<HTMLInputElement>('#schedule-total-weeks')?.value ?? scheduleDraft.totalWeeks),
  }
  return JSON.stringify(currentDraft) !== initialScheduleDraftSnapshot
}

function createSlot(source?: DraftSlot): DraftSlot {
  if (source) return { ...structuredClone(source), key: crypto.randomUUID() }
  return {
    key: crypto.randomUUID(),
    weekday: 1,
    startSection: settings.lessonTimes[0]?.section ?? 1,
    endSection: settings.lessonTimes[Math.min(1, settings.lessonTimes.length - 1)]?.section ?? 1,
    startWeek: 1,
    endWeek: maximumWeek(schedule),
    parity: 'all',
    customWeeks: false,
    selectedWeeks: rangeWeeks(1, maximumWeek(schedule), 'all'),
    location: '',
    teacher: '',
  }
}

function openNewCourse(): void {
  if (!canLeaveCourse('新增课程')) return
  selectedCourseId = null
  courseDraft = { name: '', color: palette[nextColorIndex()], slots: [createSlot()] }
  initialDraftSnapshot = JSON.stringify(courseDraft)
  surface = 'course'
  menuOpen = false
  scheduleMenuOpen = false
  surfaceMessage = ''
  render()
}

function nextColorIndex(): number {
  const counts = palette.map((color) => schedule.courses.filter((course) => course.color === color).length)
  return counts.indexOf(Math.min(...counts))
}

function openExistingCourse(courseId: string): void {
  if (!courseId || (selectedCourseId === courseId && surface === 'course')) return
  if (!canLeaveCourse('切换课程')) return
  selectedCourseId = courseId
  const courses = schedule.courses.filter((course) => course.id === courseId)
  const first = courses[0]
  if (!first) return
  courseDraft = {
    courseId,
    name: first.name,
    color: first.color,
    slots: courses.map((course) => draftSlotFromCourse(course)),
  }
  initialDraftSnapshot = JSON.stringify(courseDraft)
  surface = 'course'
  menuOpen = false
  scheduleMenuOpen = false
  surfaceMessage = ''
  render()
}

function draftSlotFromCourse(course: CatalogCourse): DraftSlot {
  const startSection = settings.lessonTimes[lessonIndexForStart(course.start)]?.section ?? 1
  const endSection = settings.lessonTimes[lessonIndexForEnd(course.end)]?.section ?? startSection
  const startWeek = Math.min(...course.weeks)
  const endWeek = Math.max(...course.weeks)
  const expected = rangeWeeks(startWeek, endWeek, course.parity)
  return {
    key: crypto.randomUUID(),
    weekday: course.weekday,
    startSection,
    endSection,
    startWeek,
    endWeek,
    parity: course.parity,
    customWeeks: expected.join(',') !== course.weeks.join(','),
    selectedWeeks: [...course.weeks],
    location: course.location,
    teacher: course.teacher,
  }
}

function rangeWeeks(start: number, end: number, parity: Parity): number[] {
  const weeks: number[] = []
  for (let week = start; week <= end; week += 1) {
    if (parity === 'all' || (parity === 'odd' ? week % 2 === 1 : week % 2 === 0)) weeks.push(week)
  }
  return weeks
}

function bindCourseEvents(): void {
  if (surface !== 'course' || !courseDraft) return
  document.querySelector<HTMLInputElement>('#course-name')?.addEventListener('input', (event) => {
    if (courseDraft) courseDraft.name = (event.currentTarget as HTMLInputElement).value
  })
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    button.addEventListener('click', () => {
      if (!courseDraft) return
      courseDraft.color = button.dataset.color ?? palette[0]
      render()
    })
  }
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-slot-field]')) {
    input.addEventListener('input', () => updateSlotField(input))
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-remove-slot]')) {
    button.addEventListener('click', () => {
      if (!courseDraft) return
      courseDraft.slots = courseDraft.slots.filter((slot) => slot.key !== button.dataset.removeSlot)
      render()
    })
  }
  document.querySelector('[data-action="add-slot"]')?.addEventListener('click', () => {
    if (!courseDraft) return
    courseDraft.slots.push(createSlot(courseDraft.slots.at(-1)))
    render()
  })
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-toggle-weeks]')) {
    button.addEventListener('click', () => {
      const slot = findSlot(button.dataset.toggleWeeks)
      if (!slot) return
      slot.customWeeks = !slot.customWeeks
      if (slot.customWeeks && slot.selectedWeeks.length === 0) slot.selectedWeeks = rangeWeeks(slot.startWeek, slot.endWeek, slot.parity)
      render()
    })
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-slot-week]')) {
    button.addEventListener('click', () => {
      const [key, value] = (button.dataset.slotWeek ?? '').split(':')
      const slot = findSlot(key)
      const week = Number(value)
      if (!slot || !week) return
      slot.selectedWeeks = slot.selectedWeeks.includes(week)
        ? slot.selectedWeeks.filter((item) => item !== week)
        : [...slot.selectedWeeks, week].sort((left, right) => left - right)
      render()
    })
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-week-action]')) {
    button.addEventListener('click', () => {
      const [action, key] = (button.dataset.weekAction ?? '').split(':')
      const slot = findSlot(key)
      if (!slot) return
      slot.selectedWeeks = action === 'all' ? Array.from({ length: Math.max(maximumWeek(schedule), 20) }, (_, index) => index + 1) : []
      render()
    })
  }
  document.querySelector('[data-action="cancel-course"]')?.addEventListener('click', () => closeSurface('explicit'))
  document.querySelector('[data-action="save-course"]')?.addEventListener('click', () => void saveCourse())
  document.querySelector('[data-action="delete-course"]')?.addEventListener('click', () => void deleteCourse())
}

function findSlot(key?: string): DraftSlot | undefined {
  return courseDraft?.slots.find((slot) => slot.key === key)
}

function updateSlotField(input: HTMLInputElement | HTMLSelectElement): void {
  const slot = findSlot(input.dataset.slot)
  const field = input.dataset.slotField
  if (!slot || !field) return
  if (field === 'weekday') slot.weekday = Number(input.value)
  if (field === 'startSection') slot.startSection = Number(input.value)
  if (field === 'endSection') slot.endSection = Number(input.value)
  if (field === 'startWeek') slot.startWeek = clamp(Number(input.value), 1, 30)
  if (field === 'endWeek') slot.endWeek = clamp(Number(input.value), 1, 30)
  if (field === 'parity') slot.parity = input.value as Parity
  if (field === 'location') slot.location = input.value
  if (field === 'teacher') slot.teacher = input.value
  if (['startWeek', 'endWeek', 'parity'].includes(field) && !slot.customWeeks) {
    slot.selectedWeeks = rangeWeeks(slot.startWeek, slot.endWeek, slot.parity)
  }
}

function buildCourseRequest(): SaveCourseRequest {
  if (!courseDraft) throw new Error('没有可保存的课程')
  const name = courseDraft.name.trim()
  if (!name) throw new Error('请填写课程名称')
  if (courseDraft.slots.length === 0) throw new Error('至少需要一个上课时间段')
  return {
    courseId: courseDraft.courseId,
    name,
    color: courseDraft.color,
    slots: courseDraft.slots.map((slot, index) => {
      if (slot.endSection < slot.startSection) throw new Error(`时间段 ${index + 1} 的结束节次不能早于开始节次`)
      const start = settings.lessonTimes.find((item) => item.section === slot.startSection)
      const end = settings.lessonTimes.find((item) => item.section === slot.endSection)
      if (!start || !end) throw new Error(`时间段 ${index + 1} 的节次不存在`)
      const weeks = slot.customWeeks ? slot.selectedWeeks : rangeWeeks(slot.startWeek, slot.endWeek, slot.parity)
      if (weeks.length === 0) throw new Error(`时间段 ${index + 1} 至少选择一个教学周`)
      return {
        weekday: slot.weekday,
        start: start.start,
        end: end.end,
        weeks,
        parity: slot.customWeeks ? 'all' : slot.parity,
        location: slot.location.trim(),
        teacher: slot.teacher.trim(),
      }
    }),
  }
}

async function saveCourse(): Promise<void> {
  try {
    const request = buildCourseRequest()
    if (desktopRuntime) {
      schedule = await invoke<CatalogSchedule>(plugin('save_course'), { request })
      summaries = await invoke<ScheduleSummary[]>(plugin('list_schedules'))
    } else {
      const id = request.courseId ?? `browser-${Date.now()}`
      schedule.courses = schedule.courses.filter((course) => course.id !== request.courseId)
      schedule.courses.push(...request.slots.map((slot) => ({ ...slot, id, name: request.name, color: request.color })))
      summaries = [summaryFromSchedule(schedule, true)]
    }
    selectedCourseId = request.courseId ?? schedule.courses.at(-1)?.id ?? null
    surface = null
    courseDraft = null
    initialDraftSnapshot = ''
    render()
    showToast('已保存')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

async function deleteCourse(): Promise<void> {
  if (!courseDraft?.courseId || !window.confirm('确定删除这门课程及其全部上课时间段吗？')) return
  try {
    if (desktopRuntime) {
      schedule = await invoke<CatalogSchedule>(plugin('delete_course'), { courseId: courseDraft.courseId })
      summaries = await invoke<ScheduleSummary[]>(plugin('list_schedules'))
    } else {
      const remaining = schedule.courses.filter((course) => course.id !== courseDraft?.courseId)
      if (remaining.length === 0) throw new Error('示例模式暂不允许删除最后一门课程')
      schedule.courses = remaining
      summaries = [summaryFromSchedule(schedule, true)]
    }
    surface = null
    selectedCourseId = null
    courseDraft = null
    render()
    showToast('课程已删除')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}


async function openScheduleEditor(id: string): Promise<void> {
  if (!id || !canLeaveCourse('编辑课表')) return
  try {
    let target: CatalogSchedule
    if (desktopRuntime) {
      target = await invoke<CatalogSchedule>(plugin('get_schedule'), { scheduleId: id })
    } else {
      target = schedule
    }
    const summary = summaries.find((item) => item.id === id) ?? summaryFromSchedule(target, id === schedule.id)
    scheduleDraft = {
      id: target.id,
      name: target.name,
      semesterStart: target.semesterStart,
      totalWeeks: maximumWeek(target),
      courseCount: summary.courseCount,
      active: summary.active,
    }
    initialScheduleDraftSnapshot = JSON.stringify(scheduleDraft)
    surface = 'schedule'
    selectedCourseId = null
    courseDraft = null
    initialDraftSnapshot = ''
    menuOpen = false
    scheduleMenuOpen = false
    surfaceMessage = ''
    render()
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

function bindScheduleEvents(): void {
  if (surface !== 'schedule' || !scheduleDraft) return
  document.querySelector<HTMLInputElement>('#schedule-name')?.addEventListener('input', (event) => {
    if (scheduleDraft) scheduleDraft.name = (event.currentTarget as HTMLInputElement).value
  })
  document.querySelector<HTMLInputElement>('#schedule-semester-start')?.addEventListener('input', (event) => {
    if (scheduleDraft) scheduleDraft.semesterStart = (event.currentTarget as HTMLInputElement).value
  })
  document.querySelector<HTMLInputElement>('#schedule-total-weeks')?.addEventListener('input', (event) => {
    if (scheduleDraft) scheduleDraft.totalWeeks = clamp(Number((event.currentTarget as HTMLInputElement).value), 1, 30)
  })
  document.querySelector('[data-action="cancel-schedule"]')?.addEventListener('click', () => closeSurface('explicit'))
  document.querySelector('[data-action="save-schedule"]')?.addEventListener('click', () => void saveSchedule())
  document.querySelector('[data-action="delete-edited-schedule"]')?.addEventListener('click', () => {
    if (scheduleDraft) void deleteSchedule(scheduleDraft.id)
  })
}

async function saveSchedule(): Promise<void> {
  if (!scheduleDraft) return
  try {
    const name = scheduleDraft.name.trim()
    if (!name) throw new Error('请填写课表名称')
    if (!scheduleDraft.semesterStart) throw new Error('请选择第一周星期一')
    const minimumWeeks = scheduleDraft.id === schedule.id ? courseMaximumWeek(schedule) : 1
    if (scheduleDraft.totalWeeks < minimumWeeks) throw new Error(`学期总周数不能少于 ${minimumWeeks} 周`)
    const semesterEnd = dateKey(addDays(parseLocalDate(scheduleDraft.semesterStart), scheduleDraft.totalWeeks * 7 - 1))

    if (desktopRuntime) {
      const updated = await invoke<CatalogSchedule>(plugin('update_schedule'), {
        request: {
          scheduleId: scheduleDraft.id,
          name,
          semesterStart: scheduleDraft.semesterStart,
          semesterEnd,
        },
      })
      if (updated.id === schedule.id) schedule = updated
      summaries = await invoke<ScheduleSummary[]>(plugin('list_schedules'))
    } else {
      schedule = { ...schedule, name, semesterStart: scheduleDraft.semesterStart, semesterEnd }
      summaries = [summaryFromSchedule(schedule, true)]
    }

    if (scheduleDraft.id === schedule.id) currentWeek = initialWeek(schedule)
    surface = 'data'
    scheduleDraft = null
    initialScheduleDraftSnapshot = ''
    surfaceMessage = ''
    render()
    showToast('课表信息已保存')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

function bindImportEvents(): void {
  document.querySelector('[data-action="choose-excel"]')?.addEventListener('click', () => void chooseExcel())
  document.querySelector('[data-action="create-imported-schedule"]')?.addEventListener('click', () => void createImportedSchedule())
  document.querySelector<HTMLInputElement>('#import-name')?.addEventListener('input', (event) => {
    importNameDraft = (event.currentTarget as HTMLInputElement).value
  })
  document.querySelector<HTMLInputElement>('#import-first-week')?.addEventListener('input', (event) => {
    importFirstWeekDraft = (event.currentTarget as HTMLInputElement).value
  })
  for (const details of document.querySelectorAll<HTMLDetailsElement>('[data-import-course-details]')) {
    details.addEventListener('toggle', () => {
      if (details.open) expandedImportCourseIndex = Number(details.dataset.importCourseDetails ?? 0)
    })
  }
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-import-field]')) {
    control.addEventListener('change', () => updateImportCourseField(control))
  }
}

function updateImportCourseField(control: HTMLInputElement | HTMLSelectElement): void {
  if (!importDraft) return
  const index = Number(control.dataset.importCourse)
  const field = control.dataset.importField
  const course = importDraft.courses[index]
  if (!course || !field) return
  expandedImportCourseIndex = index
  try {
    if (field === 'name') course.name = control.value
    if (field === 'weekday') course.weekday = Number(control.value)
    if (field === 'startSection') course.startSection = Number(control.value)
    if (field === 'endSection') course.endSection = Number(control.value)
    if (field === 'weeks') course.weeks = parseWeeksText(control.value)
    if (field === 'parity') course.parity = control.value as ImportCourse['parity']
    if (field === 'location') course.location = control.value
    if (field === 'teacher') course.teacher = control.value
    refreshImportDraftSummary(importDraft)
    surfaceMessage = ''
  } catch (error) {
    surfaceMessage = errorText(error)
  }
  render()
}

async function chooseExcel(): Promise<void> {
  if (!desktopRuntime) {
    surfaceMessage = '浏览器预览不会读取本机文件，请在桌面应用中测试。'
    render()
    return
  }
  surfaceMessage = '等待选择或解析…'
  render()
  try {
    importDraft = await invoke<ImportDraft | null>('choose_and_parse_excel')
    if (importDraft) {
      importNameDraft = importDraft.suggestedName
      importFirstWeekDraft = schedule.semesterStart
      expandedImportCourseIndex = 0
      refreshImportDraftSummary(importDraft)
      importRequestId = crypto.randomUUID()
    } else {
      importNameDraft = ''
      importFirstWeekDraft = ''
      importRequestId = ''
    }
    surfaceMessage = importDraft ? '解析完成，请逐项检查课程信息。' : '已取消选择。'
  } catch (error) {
    surfaceMessage = `解析失败：${errorText(error)}`
  }
  render()
}


async function createImportedSchedule(): Promise<void> {
  if (!importDraft || importCreatePending) return
  const name = importNameDraft.trim()
  const firstWeekMonday = importFirstWeekDraft
  try {
    if (!name) throw new Error('请填写课表名称')
    if (!firstWeekMonday) throw new Error('请确认第一周星期一')
    const issues = validateImportDraft(importDraft, settings.lessonTimes.length)
    if (issues.length) throw new Error(issues.slice(0, 3).join('；'))
    refreshImportDraftSummary(importDraft)
    importCreatePending = true
    render()
    if (desktopRuntime) {
      if (!importRequestId) importRequestId = crypto.randomUUID()
      await invoke(plugin('create_schedule_from_import'), {
        request: {
          name,
          firstWeekMonday,
          draft: importDraft,
          times: settings.lessonTimes,
          equalDuration: settings.equalDuration,
          requestId: importRequestId,
        },
      })
      await reloadDesktopState()
    }
    importDraft = null
    importNameDraft = ''
    importFirstWeekDraft = ''
    importRequestId = ''
    expandedImportCourseIndex = 0
    surface = null
    currentWeek = initialWeek(schedule)
    render()
    showToast('新课表已创建并启用')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  } finally {
    importCreatePending = false
    if (importDraft) render()
  }
}

function bindLessonTimeInput(input: HTMLInputElement, field: 'start' | 'end'): void {
  const section = Number(field === 'start' ? input.dataset.timeStart : input.dataset.timeEnd)
  const item = timeDraft.find((value) => value.section === section)
  if (!item) return
  let valueBeforeEdit = item[field]
  input.addEventListener('focus', () => {
    valueBeforeEdit = item[field]
  })
  input.addEventListener('input', () => {
    if (!isValidClockTime(input.value) || !input.validity.valid) return
    item[field] = input.value
    if (timeEqualDuration && (field === 'start' || section === 1)) applyEqualDuration()
  })
  input.addEventListener('blur', () => {
    if (isValidClockTime(input.value) && input.validity.valid) return
    input.value = valueBeforeEdit
    item[field] = valueBeforeEdit
    if (timeEqualDuration && (field === 'start' || section === 1)) applyEqualDuration()
  })
}

function bindTimeEvents(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-time-start]')) {
    bindLessonTimeInput(input, 'start')
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-time-end]')) {
    bindLessonTimeInput(input, 'end')
  }
  document.querySelector<HTMLInputElement>('#equal-duration')?.addEventListener('change', (event) => {
    timeEqualDuration = (event.currentTarget as HTMLInputElement).checked
    if (timeEqualDuration) applyEqualDuration()
    render()
  })
  document.querySelector('[data-action="add-lesson"]')?.addEventListener('click', () => {
    if (timeDraft.length >= 24) return
    const last = timeDraft.at(-1) ?? { section: 0, start: '08:00', end: '08:45' }
    const duration = Math.max(1, timeToMinutes(last.end) - timeToMinutes(last.start))
    const startMinutes = Math.min(23 * 60, timeToMinutes(last.end) + 10)
    timeDraft.push({ section: last.section + 1, start: minutesToTime(startMinutes), end: minutesToTime(Math.min(23 * 60 + 59, startMinutes + duration)) })
    render()
  })
  document.querySelector('[data-action="remove-lesson"]')?.addEventListener('click', () => {
    if (timeDraft.length > 1) timeDraft.pop()
    render()
  })
  document.querySelector('[data-action="restore-times"]')?.addEventListener('click', () => {
    timeDraft = structuredClone(defaultLessonTimes)
    timeEqualDuration = false
    render()
  })
  document.querySelector('[data-action="save-times"]')?.addEventListener('click', () => void saveTimes())
}

function applyEqualDuration(): void {
  const first = timeDraft[0]
  if (!first) return
  const duration = timeToMinutes(first.end) - timeToMinutes(first.start)
  if (duration <= 0) return
  timeDraft.forEach((item) => {
    item.end = minutesToTime(Math.min(23 * 60 + 59, timeToMinutes(item.start) + duration))
  })
}

function minutesToTime(total: number): string {
  const safe = clamp(total, 0, 23 * 60 + 59)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

async function saveTimes(): Promise<void> {
  try {
    for (const item of timeDraft) {
      if (!isValidClockTime(item.start) || !isValidClockTime(item.end)) throw new Error(`第 ${item.section} 节时间必须在 00:00～23:59 之间`)
      if (timeToMinutes(item.end) <= timeToMinutes(item.start)) throw new Error(`第 ${item.section} 节结束时间必须晚于开始时间`)
    }
    if (desktopRuntime) {
      settings = await invoke<AppSettings>('save_lesson_times', {
        request: { times: timeDraft, equalDuration: timeEqualDuration },
      })
    } else {
      settings = { ...settings, lessonTimes: structuredClone(timeDraft), equalDuration: timeEqualDuration }
    }
    surface = null
    render()
    showToast('作息时间已保存')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

function bindDataEvents(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-edit-schedule]')) {
    button.addEventListener('click', () => void openScheduleEditor(button.dataset.editSchedule ?? ''))
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-activate-schedule]')) {
    button.addEventListener('click', () => void activateSchedule(button.dataset.activateSchedule ?? ''))
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-delete-schedule]')) {
    button.addEventListener('click', () => void deleteSchedule(button.dataset.deleteSchedule ?? ''))
  }
  document.querySelector('[data-action="open-data-location"]')?.addEventListener('click', () => void openDataLocation())
}
async function activateSchedule(id: string): Promise<void> {
  if (!id || !canLeaveCourse('切换课表')) return
  try {
    if (desktopRuntime) {
      schedule = await invoke<CatalogSchedule>(plugin('activate_schedule'), { scheduleId: id })
      summaries = await invoke<ScheduleSummary[]>(plugin('list_schedules'))
    }
    currentWeek = initialWeek(schedule)
    surface = null
    menuOpen = false
    scheduleMenuOpen = false
    render()
    showToast('已切换课表')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

async function deleteSchedule(id: string): Promise<void> {
  const item = summaries.find((value) => value.id === id)
  if (!item || !window.confirm(`确定删除课表“${item.name}”吗？`)) return
  try {
    if (desktopRuntime) {
      schedule = await invoke<CatalogSchedule>(plugin('delete_schedule'), { scheduleId: id })
      summaries = await invoke<ScheduleSummary[]>(plugin('list_schedules'))
    }
    currentWeek = initialWeek(schedule)
    surface = 'data'
    scheduleDraft = null
    initialScheduleDraftSnapshot = ''
    render()
    showToast('课表已删除')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

async function openDataLocation(): Promise<void> {
  try {
    if (!desktopRuntime) throw new Error('浏览器预览无法打开本机目录')
    await invoke(plugin('open_data_location'))
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

async function toggleAutostart(): Promise<void> {
  try {
    if (!desktopRuntime) {
      autostartEnabled = !autostartEnabled
    } else {
      autostartEnabled = await invoke<boolean>(plugin('set_autostart'), { enabled: !autostartEnabled })
    }
    render()
  } catch (error) {
    menuOpen = false
    render()
    showToast(errorText(error))
  }
}

async function reloadDesktopState(): Promise<void> {
  const [active, list, appSettings, startup] = await Promise.all([
    invoke<CatalogSchedule>(plugin('get_active_schedule')),
    invoke<ScheduleSummary[]>(plugin('list_schedules')),
    invoke<AppSettings>('read_app_settings'),
    invoke<boolean>(plugin('read_autostart')),
  ])
  schedule = active
  summaries = list
  settings = appSettings
  autostartEnabled = startup
  timeDraft = structuredClone(settings.lessonTimes)
  timeEqualDuration = settings.equalDuration
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return '未知错误'
  }
}

function showToast(message: string): void {
  const toast = document.querySelector<HTMLElement>('#toast')
  if (!toast) return
  toast.textContent = message
  toast.classList.add('is-visible')
  window.setTimeout(() => toast.classList.remove('is-visible'), 1800)
}

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null
  const typing = target?.matches('input, select, textarea') ?? false
  if (event.key === 'Escape' && surface) {
    closeSurface('explicit')
  } else if (event.key === 'Escape' && (scheduleMenuOpen || menuOpen)) {
    scheduleMenuOpen = false
    menuOpen = false
    render()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    openNewCourse()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && surface === 'course') {
    event.preventDefault()
    void saveCourse()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && surface === 'schedule') {
    event.preventDefault()
    void saveSchedule()
  }
  if (!typing && !event.ctrlKey && !event.metaKey && event.key === 'ArrowLeft') changeWeek(-1)
  if (!typing && !event.ctrlKey && !event.metaKey && event.key === 'ArrowRight') changeWeek(1)
})

async function handleSettingsCloseRequest(): Promise<void> {
  await requestSettingsWindowClose({
    hasUnsavedChanges,
    confirmDiscard: () => window.confirm('放弃未保存的修改？'),
    resetState: () => {
      surface = null
      menuOpen = false
      scheduleMenuOpen = false
      selectedCourseId = null
      courseDraft = null
      initialDraftSnapshot = ''
      scheduleDraft = null
      initialScheduleDraftSnapshot = ''
      surfaceMessage = ''
      render()
    },
    hideWindow: () => invoke('hide_settings_window'),
  })
}

async function initialize(): Promise<void> {
  render()
  if (!desktopRuntime) return
  try {
    await listen('settings:close-requested', () => {
      void handleSettingsCloseRequest()
    })
    await reloadDesktopState()
    currentWeek = initialWeek(schedule)
  } catch (error) {
    console.error('[settings] initialization failed', error)
    showToast(`读取课表失败：${errorText(error)}`)
  }
  render()
}

void initialize()
