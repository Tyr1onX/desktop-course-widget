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

async function settle(): Promise<void> {
  await Promise.resolve()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  await Promise.resolve()
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

async function run(): Promise<void> {
  window.confirm = () => true
  rememberImportDraft(draft)
  await settle()

  assertSingletonStructures('initial enhancement')
  assert(document.querySelectorAll('.import-structured-warnings').length === 1, 'conflict warning should render')
  assertConfiguredLessonSections('initial enhancement')

  document.querySelector<HTMLButtonElement>('[data-import-v2-filter="pending"]')?.click()
  await settle()
  assertSingletonStructures('filter enhancement')

  const beforeAdd = draft.courses.length
  const addButton = document.querySelector<HTMLButtonElement>('[data-import-v2-add]')
  assert(addButton, 'add course button should exist')
  addButton.click()
  await settle()
  assert(draft.courses.length === beforeAdd + 1, 'one add click must add exactly one course')
  assertSingletonStructures('add enhancement')

  const addedIndex = draft.courses.length - 1
  const nameInput = document.querySelector<HTMLInputElement>(
    `[data-import-v2-course="${addedIndex}"][data-import-v2-field="name"]`,
  )
  assert(nameInput, 'new course name input should exist')
  nameInput.value = '数字信号处理'
  nameInput.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  assertSingletonStructures('edit enhancement')

  const confirmFieldButton = document.querySelector<HTMLButtonElement>('[data-import-v2-confirm-field="0:name"]')
  assert(confirmFieldButton, 'field confirmation button should exist')
  confirmFieldButton.click()
  await settle()
  assertSingletonStructures('confirm enhancement')

  const deleteButton = document.querySelector<HTMLButtonElement>(`[data-import-v2-delete="${addedIndex}"]`)
  assert(deleteButton, 'delete course button should exist')
  deleteButton.click()
  await settle()
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
