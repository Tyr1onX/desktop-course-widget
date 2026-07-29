import type {
  ImportCourse,
  ImportDraft,
  ImportDraftSummary,
  ImportFieldEvidence,
  ImportFieldKey,
  ImportIssue,
  ImportReviewStatus,
} from './import-draft'

export type ImportReviewFilter = 'all' | 'pending'

const requiredFields = new Set<ImportFieldKey>([
  'name',
  'weekday',
  'startSection',
  'endSection',
  'weeks',
  'parity',
])

let rememberImportDraftRuntime: (draft: ImportDraft) => void = () => {}

export const importFieldLabels: Record<ImportFieldKey, string> = {
  name: '课程名称',
  teacher: '老师',
  weekday: '星期',
  startSection: '开始节次',
  endSection: '结束节次',
  weeks: '教学周',
  parity: '重复',
  location: '地点',
}

export function summarizeImportCourses(courses: ImportCourse[]): ImportDraftSummary {
  return {
    arrangements: courses.length,
    highestWeek: courses.reduce((highest, course) => Math.max(highest, ...course.weeks), 0),
    locationCount: courses.filter((course) => Boolean(course.location?.trim())).length,
  }
}

export function weeksToText(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((left, right) => left - right)
  if (sorted.length === 0) return ''

  const segments: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (const week of sorted.slice(1)) {
    if (week === end + 1) {
      end = week
      continue
    }
    segments.push(start === end ? String(start) : `${start}-${end}`)
    start = week
    end = week
  }
  segments.push(start === end ? String(start) : `${start}-${end}`)
  return segments.join(', ')
}

export function parseWeeksText(value: string): number[] {
  const normalized = value
    .trim()
    .replaceAll('，', ',')
    .replaceAll('、', ',')
    .replaceAll('；', ',')
    .replaceAll(';', ',')
    .replaceAll('周', '')

  if (!normalized) throw new Error('教学周不能为空')

  const weeks = new Set<number>()
  for (const rawSegment of normalized.split(',')) {
    const segment = rawSegment.trim()
    if (!segment) continue
    const range = segment.match(/^(\d{1,2})\s*[-~～至]\s*(\d{1,2})$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start < 1 || end > 30 || start > end) throw new Error(`教学周范围“${segment}”无效`)
      for (let week = start; week <= end; week += 1) weeks.add(week)
      continue
    }

    if (!/^\d{1,2}$/.test(segment)) throw new Error(`无法识别教学周“${segment}”`)
    const week = Number(segment)
    if (week < 1 || week > 30) throw new Error(`教学周 ${week} 超出 1～30 周`)
    weeks.add(week)
  }

  if (weeks.size === 0) throw new Error('教学周不能为空')
  return [...weeks].sort((left, right) => left - right)
}

export function validateImportCourse(course: ImportCourse, lessonCount: number): string[] {
  const issues = collectImportCourseIssues(course, lessonCount, 0)
    .filter((issue) => issue.severity !== 'warning')
    .map((issue) => issue.message)
  return [...new Set(issues)]
}

export function collectImportIssues(draft: ImportDraft, lessonCount: number): ImportIssue[] {
  if (draft.courses.length === 0) {
    return [{ severity: 'error', code: 'courses.empty', message: '没有可导入的课程安排' }]
  }

  const issues = draft.courses.flatMap((course, courseIndex) => (
    collectImportCourseIssues(course, lessonCount, courseIndex)
  ))
  issues.push(...detectImportConflicts(draft.courses))
  return issues
}

export function collectIssuesForCourse(
  issues: ImportIssue[],
  courseIndex: number,
): ImportIssue[] {
  return issues.filter((issue) => (
    issue.courseIndex === courseIndex
    || issue.relatedCourseIndexes?.includes(courseIndex)
  ))
}

export function validateImportDraft(draft: ImportDraft, lessonCount: number): string[] {
  return collectImportIssues(draft, lessonCount)
    .filter((issue) => issue.severity !== 'warning')
    .map((issue) => formatIssue(issue, draft))
}

export function hasBlockingImportIssues(issues: ImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error' || issue.severity === 'review')
}

export function countPendingImportFields(draft: ImportDraft): number {
  return draft.courses.reduce(
    (total, course) => total + (course.review?.fields?.filter(isBlockingEvidence).length ?? 0),
    0,
  )
}

export function courseHasPendingReview(course: ImportCourse): boolean {
  return course.review?.fields?.some(isBlockingEvidence) ?? false
}

export function filterImportCourseIndexes(draft: ImportDraft, filter: ImportReviewFilter): number[] {
  return draft.courses.flatMap((course, index) => (
    filter === 'all' || courseHasPendingReview(course) ? [index] : []
  ))
}

export function importFieldEvidence(
  course: ImportCourse,
  field: ImportFieldKey,
): ImportFieldEvidence | undefined {
  return course.review?.fields?.find((evidence) => evidence.field === field)
}

export function importFieldStatus(course: ImportCourse, field: ImportFieldKey): ImportReviewStatus {
  return importFieldEvidence(course, field)?.status ?? 'confirmed'
}

export function confirmImportField(course: ImportCourse, field: ImportFieldKey): void {
  const evidence = importFieldEvidence(course, field)
  if (!evidence) return
  evidence.status = 'confirmed'
  delete evidence.reason
}

export function confirmCourseReview(course: ImportCourse): void {
  for (const evidence of course.review?.fields ?? []) {
    evidence.status = 'confirmed'
    delete evidence.reason
  }
}

export function updateImportCourseField(
  draft: ImportDraft,
  courseIndex: number,
  field: ImportFieldKey,
  value: string | number | number[],
): void {
  const course = draft.courses[courseIndex]
  if (!course) throw new Error('找不到要修改的导入课程')
  switch (field) {
    case 'name':
      course.name = String(value)
      break
    case 'teacher':
      course.teacher = String(value)
      break
    case 'weekday':
      course.weekday = Number(value)
      break
    case 'startSection':
      course.startSection = Number(value)
      break
    case 'endSection':
      course.endSection = Number(value)
      break
    case 'weeks':
      course.weeks = [...value as number[]]
      break
    case 'parity':
      course.parity = value as ImportCourse['parity']
      break
    case 'location':
      course.location = String(value)
      break
  }
  confirmImportField(course, field)
  refreshImportDraftSummary(draft)
}

export function createBlankImportCourse(): ImportCourse {
  return {
    code: null,
    name: '',
    teacher: '',
    weekday: 1,
    startSection: 1,
    endSection: 1,
    weeks: [1],
    parity: 'all',
    location: '',
    review: {
      fields: [
        { field: 'name', status: 'missing', reason: '新增课程需要填写名称' },
        { field: 'teacher', status: 'confirmed' },
        { field: 'weekday', status: 'confirmed' },
        { field: 'startSection', status: 'confirmed' },
        { field: 'endSection', status: 'confirmed' },
        { field: 'weeks', status: 'confirmed' },
        { field: 'parity', status: 'confirmed' },
        { field: 'location', status: 'confirmed' },
      ],
    },
  }
}

export function addBlankImportCourse(draft: ImportDraft): number {
  draft.courses.push(createBlankImportCourse())
  refreshImportDraftSummary(draft)
  return draft.courses.length - 1
}

export function removeImportCourse(draft: ImportDraft, courseIndex: number): void {
  if (!draft.courses[courseIndex]) throw new Error('找不到要删除的导入课程')
  draft.courses.splice(courseIndex, 1)
  refreshImportDraftSummary(draft)
}

export function detectImportConflicts(courses: ImportCourse[]): ImportIssue[] {
  const issues: ImportIssue[] = []
  for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
    const left = courses[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < courses.length; rightIndex += 1) {
      const right = courses[rightIndex]
      if (left.weekday !== right.weekday) continue
      if (left.startSection > right.endSection || right.startSection > left.endSection) continue
      const rightWeeks = new Set(activeWeeks(right))
      const overlappingWeeks = activeWeeks(left).filter((week) => rightWeeks.has(week))
      if (overlappingWeeks.length === 0) continue
      issues.push({
        severity: 'warning',
        code: 'course.time.conflict',
        message: `第 ${leftIndex + 1} 项与第 ${rightIndex + 1} 项在第 ${overlappingWeeks.join('、')} 周的节次重叠`,
        courseIndex: leftIndex,
        relatedCourseIndexes: [leftIndex, rightIndex],
      })
    }
  }
  return issues
}

export function refreshImportDraftSummary(draft: ImportDraft): void {
  draft.summary = summarizeImportCourses(draft.courses)
  rememberImportDraftRuntime(draft)
}

function collectImportCourseIssues(
  course: ImportCourse,
  lessonCount: number,
  courseIndex: number,
): ImportIssue[] {
  const issues: ImportIssue[] = []
  const push = (
    severity: ImportIssue['severity'],
    code: string,
    message: string,
    field?: ImportFieldKey,
  ): void => {
    issues.push({ severity, code, message, courseIndex, field })
  }

  if (!course.name.trim()) push('error', 'course.name.empty', '课程名称不能为空', 'name')
  if (!Number.isInteger(course.weekday) || course.weekday < 1 || course.weekday > 7) {
    push('error', 'course.weekday.invalid', '星期无效', 'weekday')
  }
  if (!Number.isInteger(course.startSection) || course.startSection < 1 || course.startSection > lessonCount) {
    push('error', 'course.startSection.invalid', '开始节次无效', 'startSection')
  }
  if (!Number.isInteger(course.endSection) || course.endSection < course.startSection || course.endSection > lessonCount) {
    push('error', 'course.endSection.invalid', '结束节次无效', 'endSection')
  }
  if (course.weeks.length === 0 || course.weeks.some((week) => !Number.isInteger(week) || week < 1 || week > 30)) {
    push('error', 'course.weeks.invalid', '教学周无效', 'weeks')
  }
  if (!['all', 'odd', 'even'].includes(course.parity)) {
    push('error', 'course.parity.invalid', '单双周设置无效', 'parity')
  }

  for (const evidence of course.review?.fields ?? []) {
    if (evidence.status === 'confirmed') continue
    const label = importFieldLabels[evidence.field]
    if (evidence.status === 'review') {
      push(
        'review',
        'review.field.unconfirmed',
        `${label}需要确认${evidence.reason ? `：${evidence.reason}` : ''}`,
        evidence.field,
      )
      continue
    }
    const required = requiredFields.has(evidence.field)
    push(
      required ? 'review' : 'warning',
      required ? 'review.field.requiredMissing' : 'review.field.optionalMissing',
      required ? `${label}缺失，请补充后确认` : `${label}未识别，可留空`,
      evidence.field,
    )
  }

  return issues
}

function isBlockingEvidence(evidence: ImportFieldEvidence): boolean {
  return evidence.status === 'review' || (evidence.status === 'missing' && requiredFields.has(evidence.field))
}

function activeWeeks(course: ImportCourse): number[] {
  return [...new Set(course.weeks)].filter((week) => {
    if (course.parity === 'odd') return week % 2 === 1
    if (course.parity === 'even') return week % 2 === 0
    return true
  })
}

function formatIssue(issue: ImportIssue, draft: ImportDraft): string {
  if (issue.courseIndex === undefined) return issue.message
  const course = draft.courses[issue.courseIndex]
  return `第 ${issue.courseIndex + 1} 项“${course?.name.trim() || '未命名课程'}”：${issue.message}`
}

if (typeof document !== 'undefined') {
  void import('./import-review-controller').then(({ installImportReviewRuntime, rememberImportDraft }) => {
    rememberImportDraftRuntime = rememberImportDraft
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
  }).catch((error) => {
    console.error('[import-review] could not load review runtime', error)
  })
}
