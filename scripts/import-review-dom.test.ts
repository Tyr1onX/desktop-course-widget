import type { ImportCourse, ImportDraft } from '../src/import-draft'
import {
  addBlankImportCourse,
  collectImportIssues,
  collectIssuesForCourse,
  confirmCourseReview,
  confirmImportField,
  countPendingImportFields,
  filterImportCourseIndexes,
  hasBlockingImportIssues,
  importFieldEvidence,
  importFieldLabels,
  importFieldStatus,
  parseWeeksText,
  removeImportCourse,
  summarizeImportCourses,
  updateImportCourseField,
  weeksToText,
} from '../src/import-review'
import { installImportReviewRuntime, rememberImportDraft } from '../src/import-review-controller'
import { createWidget, defaultOptions, setActiveSchedule, type ScheduleSource, type WidgetOptions } from '../src/widget'

const result = document.querySelector<HTMLElement>('#result')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function course(overrides: Partial<ImportCourse> = {}): ImportCourse {
  return {
    name: '通信原理',
    teacher: '张老师',
    weekday: 2,
    startSection: 3,
    endSection: 4,
    weeks: [1, 2, 3],
    parity: 'all',
    location: 'A101',
    ...overrides,
  }
}

const courses = [
  course({
    review: {
      fields: [{
        field: 'name',
        status: 'review',
        confidence: 0.62,
        rawText: '通信原埋',
        reason: '低于自动确认阈值',
      }],
    },
  }),
  course({ name: '信息论', teacher: '李老师' }),
]

const draft: ImportDraft = {
  schemaVersion: 1,
  source: 'image',
  sourceName: 'fixture.png',
  suggestedName: 'DOM 回归测试',
  summary: summarizeImportCourses(courses),
  warnings: [],
  courses,
}

installImportReviewRuntime({
  addBlankCourse: addBlankImportCourse,
  collectIssues: collectImportIssues,
  collectCourseIssues: collectIssuesForCourse,
  confirmCourse: confirmCourseReview,
  confirmField: confirmImportField,
  countPending: countPendingImportFields,
  fieldEvidence: importFieldEvidence,
  fieldLabels: importFieldLabels,
  fieldStatus: importFieldStatus,
  filterIndexes: filterImportCourseIndexes,
  hasBlockingIssues: hasBlockingImportIssues,
  parseWeeks: parseWeeksText,
  removeCourse: removeImportCourse,
  updateField: updateImportCourseField,
  weeksText: weeksToText,
})

async function waitFor(condition: () => boolean, message: string, timeout = 3_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await Promise.resolve()
    if (condition()) return
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
  }
  throw new Error(message)
}

function assertSingletonStructures(stage: string): void {
  assert(
    document.querySelectorAll('.import-review-toolbar').length === 1,
    `${stage}: import review toolbar must remain singular`,
  )
  assert(
    document.querySelectorAll('.import-structured-warnings').length <= 1,
    `${stage}: structured warning section must not duplicate`,
  )
}

function assertConfiguredLessonSections(stage: string): void {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('[data-import-v2-field="startSection"]')]
  assert(selects.length > 0, `${stage}: start-section controls should exist`)
  assert(
    selects.every((select) => select.options.length === 12),
    `${stage}: every start-section control should keep all 12 configured sections`,
  )
}

function assertImportStepHeadings(): void {
  assert(
    document.querySelector<HTMLElement>('.import-step-title')?.textContent?.trim() === '1 · 选择文件',
    'first import step must be real DOM text',
  )
  assert(
    document.querySelector<HTMLElement>('.import-review-heading h3')?.textContent?.trim() === '2 · 检查解析结果',
    'second import step must replace the old 逐项检查 title',
  )
  assert(
    document.querySelector<HTMLElement>('.import-step-label')?.textContent?.trim() === '3 · 确认创建',
    'third import step must be real DOM text',
  )
}

function widgetSchedule(options: {
  semesterStart?: string
  semesterEnd?: string | null
  maxCourseWeek?: number
} = {}): ScheduleSource {
  const maxCourseWeek = options.maxCourseWeek ?? 18
  return {
    semesterStart: options.semesterStart ?? '2024-05-13',
    ...(options.semesterEnd === undefined ? {} : { semesterEnd: options.semesterEnd }),
    courses: [{
      name: '测试课程',
      teacher: '',
      weekday: 1,
      start: '08:00',
      end: '09:40',
      location: '',
      weeks: Array.from({ length: maxCourseWeek }, (_, index) => index + 1),
      parity: 'all',
    }],
  }
}

function assertWeekMeta(widget: HTMLElement, weekText: string, rangeText: string, stage: string): void {
  const spans = [...widget.querySelectorAll<HTMLElement>('.widget-week-meta span')]
  assert(spans.length === 2, `${stage}: week metadata should render exactly two values`)
  assert(spans[0]?.textContent?.trim() === weekText, `${stage}: unexpected teaching week text`)
  assert(spans[1]?.textContent?.trim() === rangeText, `${stage}: unexpected week range text`)
}

function assertNoWeekMeta(widget: HTMLElement, stage: string): void {
  assert(widget.querySelector('.widget-week-meta') === null, `${stage}: week metadata should be hidden outside semester`)
}

function runWidgetWeekInfoCases(): void {
  setActiveSchedule(widgetSchedule({
    semesterStart: '2026-09-07',
    semesterEnd: '2027-01-10',
    maxCourseWeek: 3,
  }))
  const ordinary = createWidget({
    ...defaultOptions,
    runtime: 'live',
    now: new Date(2026, 8, 23, 12, 0),
  })
  assertWeekMeta(ordinary, '教学周 3 / 18', '9月21日 – 9月27日', 'ordinary week with semesterEnd')

  setActiveSchedule(widgetSchedule({
    semesterStart: '2024-05-13',
    semesterEnd: '2024-09-15',
    maxCourseWeek: 18,
  }))
  const crossMonth = createWidget({
    ...defaultOptions,
    runtime: 'live',
    now: new Date(2024, 4, 29, 12, 0),
  })
  assertWeekMeta(crossMonth, '教学周 3 / 18', '5月27日 – 6月2日', 'cross-month week')

  setActiveSchedule(widgetSchedule({
    semesterStart: '2024-05-13',
    maxCourseWeek: 16,
  }))
  const fallback = createWidget({
    ...defaultOptions,
    runtime: 'live',
    now: new Date(2024, 4, 29, 12, 0),
  })
  assertWeekMeta(fallback, '教学周 3 / 16', '5月27日 – 6月2日', 'course max-week fallback')

  setActiveSchedule(widgetSchedule({
    semesterStart: '2024-05-13',
    semesterEnd: '2024-09-15',
    maxCourseWeek: 18,
  }))
  const navigationOptions: WidgetOptions = {
    ...defaultOptions,
    runtime: 'live',
    now: new Date(2024, 4, 19, 12, 0),
    showNav: true,
  }
  let navigatedWidget: HTMLElement
  const rerenderNavigatedWidget = () => {
    navigatedWidget = createWidget(navigationOptions, rerenderNavigatedWidget)
  }
  rerenderNavigatedWidget()
  assertWeekMeta(navigatedWidget!, '教学周 1 / 18', '5月13日 – 5月19日', 'navigation initial week')

  const next = navigatedWidget!.querySelector<HTMLButtonElement>('[data-nav="next"]')
  assert(next, 'next-day navigation button should exist')
  next.click()
  assertWeekMeta(navigatedWidget!, '教学周 2 / 18', '5月20日 – 5月26日', 'next day crossing week')

  const previous = navigatedWidget!.querySelector<HTMLButtonElement>('[data-nav="previous"]')
  assert(previous, 'previous-day navigation button should exist')
  previous.click()
  assertWeekMeta(navigatedWidget!, '教学周 1 / 18', '5月13日 – 5月19日', 'previous day returning week')

  navigationOptions.browseDate = new Date(2024, 5, 3, 12, 0)
  rerenderNavigatedWidget()
  assertWeekMeta(navigatedWidget!, '教学周 4 / 18', '6月3日 – 6月9日', 'browsing another teaching week')

  setActiveSchedule(widgetSchedule({
    semesterStart: '2024-05-13',
    semesterEnd: '2024-09-15',
    maxCourseWeek: 18,
  }))
  const before = createWidget({
    ...defaultOptions,
    runtime: 'live',
    now: new Date(2024, 4, 12, 12, 0),
  })
  assertNoWeekMeta(before, 'before semester')

  const after = createWidget({
    ...defaultOptions,
    runtime: 'live',
    now: new Date(2024, 8, 16, 12, 0),
  })
  assertNoWeekMeta(after, 'after semester')
}

async function run(): Promise<void> {
  window.confirm = () => true
  assertImportStepHeadings()
  rememberImportDraft(draft)
  await waitFor(
    () => document.querySelectorAll('.import-review-toolbar').length === 1,
    'initial import review enhancement should render',
  )

  assertSingletonStructures('initial enhancement')
  assert(document.querySelectorAll('.import-structured-warnings').length === 1, 'conflict warning should render')
  assertConfiguredLessonSections('initial enhancement')

  document.querySelector<HTMLButtonElement>('[data-import-v2-filter="pending"]')?.click()
  await waitFor(
    () => document.querySelector<HTMLButtonElement>('[data-import-v2-filter="pending"]')?.classList.contains('is-active') === true,
    'pending filter should become active',
  )
  assertSingletonStructures('filter enhancement')

  const beforeAdd = draft.courses.length
  const addButton = document.querySelector<HTMLButtonElement>('[data-import-v2-add]')
  assert(addButton, 'add course button should exist')
  addButton.click()
  await waitFor(() => draft.courses.length === beforeAdd + 1, 'one add click should update the draft')
  assert(draft.courses.length === beforeAdd + 1, 'one add click must add exactly one course')
  assertSingletonStructures('add enhancement')

  const addedIndex = draft.courses.length - 1
  await waitFor(
    () => Boolean(document.querySelector(`[data-import-v2-course="${addedIndex}"][data-import-v2-field="name"]`)),
    'new course controls should render',
  )
  const nameInput = document.querySelector<HTMLInputElement>(
    `[data-import-v2-course="${addedIndex}"][data-import-v2-field="name"]`,
  )
  assert(nameInput, 'new course name input should exist')
  nameInput.value = '数字信号处理'
  nameInput.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => draft.courses[addedIndex]?.name === '数字信号处理', 'course edit should update the draft')
  assertSingletonStructures('edit enhancement')

  const confirmFieldButton = document.querySelector<HTMLButtonElement>('[data-import-v2-confirm-field="0:name"]')
  assert(confirmFieldButton, 'field confirmation button should exist')
  confirmFieldButton.click()
  await waitFor(
    () => document.querySelector('[data-import-v2-confirm-field="0:name"]') === null,
    'confirmed field control should disappear',
  )
  assertSingletonStructures('confirm enhancement')

  const deleteButton = document.querySelector<HTMLButtonElement>(`[data-import-v2-delete="${addedIndex}"]`)
  assert(deleteButton, 'delete course button should exist')
  deleteButton.click()
  await waitFor(() => draft.courses.length === beforeAdd, 'delete should update the draft')
  assert(draft.courses.length === beforeAdd, 'delete should remove only the selected draft course')
  assertSingletonStructures('delete enhancement')
  assertConfiguredLessonSections('repeated enhancements')

  let warningConfirmCalls = 0
  window.confirm = (message?: string) => {
    if (String(message).includes('检测到')) warningConfirmCalls += 1
    return false
  }
  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  assert(createButton && !createButton.disabled, 'warning-only draft should allow explicit creation')
  createButton.click()
  assert(warningConfirmCalls === 1, 'create warning confirmation listener must bind exactly once')

  runWidgetWeekInfoCases()
}

try {
  await run()
  if (result) {
    result.dataset.status = 'pass'
    result.textContent = 'PASS'
  }
} catch (error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  if (result) {
    result.dataset.status = 'fail'
    result.textContent = `FAIL\n${message}`
  }
  console.error(error)
}
