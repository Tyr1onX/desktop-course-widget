import type {
  ImportCourse,
  ImportDraft,
  ImportFieldEvidence,
  ImportFieldKey,
  ImportIssue,
  ImportReviewStatus,
} from './import-draft'

type ImportReviewFilter = 'all' | 'pending'

type RuntimeApi = {
  addBlankCourse: (draft: ImportDraft) => number
  collectIssues: (draft: ImportDraft, lessonCount: number) => ImportIssue[]
  collectCourseIssues: (issues: ImportIssue[], courseIndex: number) => ImportIssue[]
  confirmCourse: (course: ImportCourse) => void
  confirmField: (course: ImportCourse, field: ImportFieldKey) => void
  countPending: (draft: ImportDraft) => number
  fieldEvidence: (course: ImportCourse, field: ImportFieldKey) => ImportFieldEvidence | undefined
  fieldLabels: Record<ImportFieldKey, string>
  fieldStatus: (course: ImportCourse, field: ImportFieldKey) => ImportReviewStatus
  filterIndexes: (draft: ImportDraft, filter: ImportReviewFilter) => number[]
  hasBlockingIssues: (issues: ImportIssue[]) => boolean
  parseWeeks: (value: string) => number[]
  removeCourse: (draft: ImportDraft, courseIndex: number) => void
  updateField: (
    draft: ImportDraft,
    courseIndex: number,
    field: ImportFieldKey,
    value: string | number | number[],
  ) => void
  weeksText: (weeks: number[]) => string
}

const requiredFields = new Set<ImportFieldKey>([
  'name',
  'weekday',
  'startSection',
  'endSection',
  'weeks',
  'parity',
])

let runtimeApi: RuntimeApi | null = null
let activeDraft: ImportDraft | null = null
let filter: ImportReviewFilter = 'all'
let expandedCourseIndex = -1
let activeLessonSections: number[] = []
let observer: MutationObserver | null = null
let renderQueued = false

export function installImportReviewRuntime(api: RuntimeApi): void {
  runtimeApi = api
  if (typeof document === 'undefined' || observer) return
  void import('./import-review-v2.css')
  observer = new MutationObserver(() => queueEnhancement())
  const start = (): void => {
    if (!document.body || !observer) return
    observer.observe(document.body, { childList: true, subtree: true })
    queueEnhancement()
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}

export function rememberImportDraft(draft: ImportDraft): void {
  if (activeDraft !== draft) {
    filter = 'all'
    expandedCourseIndex = draft.source === 'image' ? -1 : 0
    activeLessonSections = []
  }
  activeDraft = draft
  queueEnhancement()
}

function queueEnhancement(force = false): void {
  if (typeof document === 'undefined' || renderQueued) return
  renderQueued = true
  queueMicrotask(() => {
    renderQueued = false
    enhanceImportSurface(force)
  })
}

function enhanceImportSurface(force = false): void {
  const api = runtimeApi
  const draft = activeDraft
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!api || !draft || !surface) return

  const lessonSections = readLessonSections(surface, draft)
  const lessonCount = lessonSections.at(-1) ?? 1
  const issues = api.collectIssues(draft, lessonCount)
  const pendingCount = api.countPending(draft)
  const visibleIndexes = api.filterIndexes(draft, filter)
  const signature = JSON.stringify({
    courses: draft.courses,
    filter,
    expandedCourseIndex,
    lessonSections,
    issueCodes: issues.map((issue) => [issue.severity, issue.code, issue.courseIndex, issue.relatedCourseIndexes]),
  })
  if (!force && surface.dataset.importReviewV2Signature === signature) {
    updateCreateButton(api, draft, issues)
    return
  }
  surface.dataset.importReviewV2Signature = signature

  updateSummary(surface, pendingCount)
  const heading = surface.querySelector<HTMLElement>('.import-review-heading')
  const list = surface.querySelector<HTMLElement>('.import-review-list')
  if (!heading || !list) return

  const imageDraft = draft.source === 'image'
  heading.innerHTML = `
    <div>
      <h3>${imageDraft ? '快速检查识别结果' : '逐项检查'}</h3>
      <p>${imageDraft
        ? '先浏览课程摘要；整体无误可一次确认全部，只有异常项需要展开修改。'
        : '修改字段会自动确认；课程冲突会提示，但允许明确继续创建。'}</p>
    </div>
    <span>${draft.courses.length} 项</span>
  `
  surface.querySelectorAll('.import-review-toolbar').forEach((element) => element.remove())
  const toolbar = document.createElement('div')
  toolbar.className = 'import-review-toolbar'
  toolbar.innerHTML = `
    <div class="import-review-filter" role="group" aria-label="导入课程筛选">
      <button type="button" data-import-v2-filter="all" class="${filter === 'all' ? 'is-active' : ''}">全部</button>
      <button type="button" data-import-v2-filter="pending" class="${filter === 'pending' ? 'is-active' : ''}">只看需处理项</button>
    </div>
    <div class="import-review-toolbar-actions">
      ${imageDraft && pendingCount > 0
        ? '<button class="import-review-confirm-all" type="button" data-import-v2-confirm-all>✓ 一键确认全部已识别内容</button>'
        : ''}
      <button class="secondary-button" type="button" data-import-v2-add>＋ 新增课程安排</button>
    </div>
  `
  heading.after(toolbar)

  renderWarnings(surface, issues)
  list.innerHTML = visibleIndexes.length
    ? visibleIndexes.map((index) => courseMarkup(api, draft.courses[index], index, issues, lessonSections)).join('')
    : `<div class="import-review-empty">${filter === 'pending' ? '没有需要处理的课程安排' : '暂无课程安排，可以新增一项'}</div>`

  bindRuntimeEvents(surface, api, draft, lessonCount)
  updateCreateButton(api, draft, issues)
}

function readLessonSections(surface: HTMLElement, draft: ImportDraft): number[] {
  const discovered = [...surface.querySelectorAll<HTMLOptionElement>('[data-import-field="startSection"] option')]
    .map((option) => Number(option.value))
    .filter((value) => Number.isInteger(value) && value > 0)
  if (discovered.length) {
    activeLessonSections = [...new Set(discovered)].sort((left, right) => left - right)
    return activeLessonSections
  }
  if (activeLessonSections.length) return activeLessonSections
  const maximum = Math.max(1, ...draft.courses.map((course) => course.endSection))
  activeLessonSections = Array.from({ length: maximum }, (_, index) => index + 1)
  return activeLessonSections
}

function updateSummary(surface: HTMLElement, pendingCount: number): void {
  const values = surface.querySelectorAll<HTMLElement>('.import-summary strong')
  if (values[2]) values[2].textContent = `${pendingCount} 项`
}

function renderWarnings(surface: HTMLElement, issues: ImportIssue[]): void {
  surface.querySelectorAll('.import-structured-warnings').forEach((element) => element.remove())
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  if (!warnings.length) return

  const grouped = new Map<string, { issue: ImportIssue, count: number }>()
  for (const warning of warnings) {
    const key = `${warning.code}\u0000${warning.message}`
    const current = grouped.get(key)
    if (current) current.count += 1
    else grouped.set(key, { issue: warning, count: 1 })
  }

  const section = document.createElement('section')
  section.className = 'import-structured-warnings'
  section.innerHTML = `
    <strong>可留空或稍后检查</strong>
    <ul>${[...grouped.values()].map(({ issue, count }) => {
      const suffix = count > 1
        ? issue.code === 'review.field.optionalMissing'
          ? `（${count} 门课程）`
          : `（${count} 项）`
        : ''
      return `<li>${escapeHtml(`${issue.message}${suffix}`)}</li>`
    }).join('')}</ul>
  `
  surface.querySelector('.import-review-heading')?.before(section)
}

function courseMarkup(
  api: RuntimeApi,
  course: ImportCourse,
  index: number,
  allIssues: ImportIssue[],
  lessonSections: number[],
): string {
  const issues = api.collectCourseIssues(allIssues, index)
  const visibleIssues = issues.filter((issue) => issue.code !== 'review.field.optionalMissing')
  const blockingIssues = visibleIssues.filter((issue) => issue.severity !== 'warning')
  const warningIssues = visibleIssues.filter((issue) => issue.severity === 'warning')
  const pending = course.review?.fields?.filter((evidence) => (
    evidence.status === 'review'
    || (evidence.status === 'missing' && requiredFields.has(evidence.field))
  )).length ?? 0
  const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][course.weekday - 1] ?? '星期待确认'
  const sections = course.startSection === course.endSection
    ? `第 ${course.startSection} 节`
    : `第 ${course.startSection}–${course.endSection} 节`
  const state = pending
    ? `${pending} 个字段待确认`
    : blockingIssues.length
      ? `${blockingIssues.length} 项需修正`
      : warningIssues.length
        ? `${warningIssues.length} 项提醒`
        : '信息完整'
  const optionMarkup = lessonSections.map((section) => `<option value="${section}">${section}</option>`).join('')

  return `
    <details class="import-course-review${blockingIssues.length ? ' has-issues' : ''}${warningIssues.length ? ' has-warnings' : ''}" data-import-v2-details="${index}"${expandedCourseIndex === index ? ' open' : ''}>
      <summary>
        <span class="import-course-copy">
          <strong>${escapeHtml(course.name.trim() || `未命名课程 ${index + 1}`)}</strong>
          <small>${escapeHtml(`${weekday} · ${sections} · ${api.weeksText(course.weeks) || '周次待确认'}周`)}</small>
        </span>
        <span class="import-course-state">${escapeHtml(state)}</span>
      </summary>
      <div class="import-course-review-actions">
        ${pending ? `<button type="button" data-import-v2-confirm-course="${index}">确认本课程剩余字段</button>` : ''}
        <button class="is-danger" type="button" data-import-v2-delete="${index}">删除此项</button>
      </div>
      <div class="import-course-review-grid">
        ${fieldMarkup(api, course, index, 'name', `<input value="${escapeHtml(course.name)}" maxlength="160" data-import-v2-course="${index}" data-import-v2-field="name" />`, true)}
        ${fieldMarkup(api, course, index, 'weekday', `<select data-import-v2-course="${index}" data-import-v2-field="weekday">${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, offset) => `<option value="${offset + 1}"${course.weekday === offset + 1 ? ' selected' : ''}>${label}</option>`).join('')}</select>`)}
        ${fieldMarkup(api, course, index, 'parity', `<select data-import-v2-course="${index}" data-import-v2-field="parity"><option value="all"${course.parity === 'all' ? ' selected' : ''}>每周</option><option value="odd"${course.parity === 'odd' ? ' selected' : ''}>单周</option><option value="even"${course.parity === 'even' ? ' selected' : ''}>双周</option></select>`)}
        ${fieldMarkup(api, course, index, 'startSection', `<select data-import-v2-course="${index}" data-import-v2-field="startSection">${selectValue(optionMarkup, course.startSection)}</select>`)}
        ${fieldMarkup(api, course, index, 'endSection', `<select data-import-v2-course="${index}" data-import-v2-field="endSection">${selectValue(optionMarkup, course.endSection)}</select>`)}
        ${fieldMarkup(api, course, index, 'weeks', `<input value="${escapeHtml(api.weeksText(course.weeks))}" placeholder="例如 1-8, 10-16" data-import-v2-course="${index}" data-import-v2-field="weeks" />`, true)}
        ${fieldMarkup(api, course, index, 'location', `<input value="${escapeHtml(course.location ?? '')}" maxlength="160" placeholder="选填" data-import-v2-course="${index}" data-import-v2-field="location" />`)}
        ${fieldMarkup(api, course, index, 'teacher', `<input value="${escapeHtml(course.teacher ?? '')}" maxlength="160" placeholder="选填" data-import-v2-course="${index}" data-import-v2-field="teacher" />`)}
      </div>
      ${visibleIssues.length ? `<ul class="import-course-issues">${visibleIssues.map((issue) => `<li class="is-${issue.severity}">${escapeHtml(issue.message)}</li>`).join('')}</ul>` : ''}
    </details>
  `
}

function fieldMarkup(
  api: RuntimeApi,
  course: ImportCourse,
  index: number,
  field: ImportFieldKey,
  control: string,
  wide = false,
): string {
  const reviewAware = Boolean(course.review)
  const status = api.fieldStatus(course, field)
  const evidence = api.fieldEvidence(course, field)
  const evidenceCopy = [
    evidence?.confidence === undefined ? '' : `置信度 ${Math.round(evidence.confidence * 100)}%`,
    evidence?.rawText ? `原文：${evidence.rawText}` : '',
    evidence?.reason ?? '',
  ].filter(Boolean).join(' · ')
  return `
    <div class="field${wide ? ' field--full' : ''}${reviewAware ? ` import-review-field is-${status}` : ''}">
      <div class="import-review-field-heading">
        <label>${escapeHtml(api.fieldLabels[field])}</label>
        ${reviewAware ? `<span class="import-field-status is-${status}">${statusCopy(status)}</span>` : ''}
      </div>
      ${control}
      ${reviewAware && evidenceCopy ? `<small class="import-evidence-copy">${escapeHtml(evidenceCopy)}</small>` : ''}
      ${reviewAware && status !== 'confirmed' ? `<button class="import-confirm-field" type="button" data-import-v2-confirm-field="${index}:${field}">确认此字段</button>` : ''}
    </div>
  `
}

function bindRuntimeEvents(
  surface: HTMLElement,
  api: RuntimeApi,
  draft: ImportDraft,
  lessonCount: number,
): void {
  surface.querySelectorAll<HTMLButtonElement>('[data-import-v2-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      filter = button.dataset.importV2Filter as ImportReviewFilter
      invalidateAndRender(surface)
    })
  })
  surface.querySelector<HTMLButtonElement>('[data-import-v2-confirm-all]')?.addEventListener('click', () => {
    const confirmedCount = confirmRecognizedFields(api, draft)
    const remaining = api.countPending(draft)
    filter = remaining > 0 ? 'pending' : 'all'
    expandedCourseIndex = remaining > 0 ? firstPendingCourseIndex(draft) : -1
    showMessage(
      surface,
      remaining > 0
        ? `已确认 ${confirmedCount} 个识别字段，仍有 ${remaining} 个必填项需要处理。`
        : `已确认 ${confirmedCount} 个识别字段，可以创建课表。`,
    )
    invalidateAndRender(surface)
  })
  surface.querySelector<HTMLButtonElement>('[data-import-v2-add]')?.addEventListener('click', () => {
    expandedCourseIndex = api.addBlankCourse(draft)
    filter = 'all'
    showMessage(surface, '已新增一项空白课程安排，请补充课程名称。')
    invalidateAndRender(surface)
  })
  surface.querySelectorAll<HTMLDetailsElement>('[data-import-v2-details]').forEach((details) => {
    details.addEventListener('toggle', () => {
      const courseIndex = Number(details.dataset.importV2Details ?? -1)
      if (details.open) expandedCourseIndex = courseIndex
      else if (expandedCourseIndex === courseIndex) expandedCourseIndex = -1
    })
  })
  surface.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-import-v2-field]').forEach((control) => {
    control.addEventListener('change', () => {
      const courseIndex = Number(control.dataset.importV2Course)
      const field = control.dataset.importV2Field as ImportFieldKey
      try {
        const value = field === 'weeks'
          ? api.parseWeeks(control.value)
          : ['weekday', 'startSection', 'endSection'].includes(field)
            ? Number(control.value)
            : control.value
        api.updateField(draft, courseIndex, field, value)
        expandedCourseIndex = courseIndex
        showMessage(surface, '')
      } catch (error) {
        showMessage(surface, errorText(error))
      }
      invalidateAndRender(surface)
    })
  })
  surface.querySelectorAll<HTMLButtonElement>('[data-import-v2-confirm-field]').forEach((button) => {
    button.addEventListener('click', () => {
      const [courseIndexText, field] = (button.dataset.importV2ConfirmField ?? '').split(':')
      const courseIndex = Number(courseIndexText)
      const course = draft.courses[courseIndex]
      if (!course || !field) return
      api.confirmField(course, field as ImportFieldKey)
      expandedCourseIndex = courseIndex
      invalidateAndRender(surface)
    })
  })
  surface.querySelectorAll<HTMLButtonElement>('[data-import-v2-confirm-course]').forEach((button) => {
    button.addEventListener('click', () => {
      const courseIndex = Number(button.dataset.importV2ConfirmCourse)
      const course = draft.courses[courseIndex]
      if (!course) return
      api.confirmCourse(course)
      expandedCourseIndex = courseIndex
      invalidateAndRender(surface)
    })
  })
  surface.querySelectorAll<HTMLButtonElement>('[data-import-v2-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const courseIndex = Number(button.dataset.importV2Delete)
      const course = draft.courses[courseIndex]
      if (!course || !window.confirm(`仅从本次导入草稿中删除“${course.name.trim() || `第 ${courseIndex + 1} 项`}”？`)) return
      api.removeCourse(draft, courseIndex)
      expandedCourseIndex = Math.max(-1, Math.min(courseIndex, draft.courses.length - 1))
      invalidateAndRender(surface)
    })
  })

  const create = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  if (create && create.dataset.importV2WarningBound !== 'true') {
    create.dataset.importV2WarningBound = 'true'
    create.addEventListener('click', (event) => {
      const currentApi = runtimeApi
      const currentDraft = activeDraft
      if (!currentApi || !currentDraft) return
      const currentLessonCount = activeLessonSections.at(-1) ?? lessonCount
      const warnings = currentApi.collectIssues(currentDraft, currentLessonCount)
        .filter((issue) => issue.severity === 'warning')
      if (!warnings.length) return
      if (!window.confirm(`检测到 ${warnings.length} 项提醒，其中可能包含课程时间冲突。仍然创建课表吗？`)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }, { capture: true })
  }
}

function confirmRecognizedFields(api: RuntimeApi, draft: ImportDraft): number {
  let confirmedCount = 0
  for (const course of draft.courses) {
    for (const evidence of course.review?.fields ?? []) {
      const canConfirm = evidence.status === 'review'
        || (evidence.status === 'missing' && !requiredFields.has(evidence.field))
      if (!canConfirm) continue
      api.confirmField(course, evidence.field)
      confirmedCount += 1
    }
  }
  return confirmedCount
}

function firstPendingCourseIndex(draft: ImportDraft): number {
  return draft.courses.findIndex((course) => course.review?.fields?.some((evidence) => (
    evidence.status === 'review'
    || (evidence.status === 'missing' && requiredFields.has(evidence.field))
  )))
}

function updateCreateButton(api: RuntimeApi, draft: ImportDraft, issues: ImportIssue[]): void {
  const button = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  if (!button) return
  const blocking = api.hasBlockingIssues(issues) || draft.courses.length === 0
  if (blocking) {
    button.dataset.importV2Blocked = 'true'
    button.disabled = true
  } else if (button.dataset.importV2Blocked === 'true') {
    delete button.dataset.importV2Blocked
    button.disabled = false
  }
}

function invalidateAndRender(surface: HTMLElement): void {
  delete surface.dataset.importReviewV2Signature
  queueEnhancement(true)
}

function showMessage(surface: HTMLElement, message: string): void {
  const target = surface.querySelector<HTMLElement>('.surface-message')
  if (target) target.textContent = message
}

function selectValue(options: string, value: number): string {
  return options.replace(`value="${value}"`, `value="${value}" selected`)
}

function statusCopy(status: ImportReviewStatus): string {
  if (status === 'review') return '待确认'
  if (status === 'missing') return '缺失'
  return '已确认'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
