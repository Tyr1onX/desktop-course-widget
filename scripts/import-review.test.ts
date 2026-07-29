import assert from 'node:assert/strict'
import test from 'node:test'
import type { ImportCourse, ImportDraft } from '../src/import-draft.ts'
import {
  addBlankImportCourse,
  collectImportIssues,
  confirmCourseReview,
  countPendingImportFields,
  detectImportConflicts,
  filterImportCourseIndexes,
  hasBlockingImportIssues,
  parseWeeksText,
  removeImportCourse,
  summarizeImportCourses,
  updateImportCourseField,
  validateImportCourse,
  validateImportDraft,
  weeksToText,
} from '../src/import-review.ts'

const course = (overrides: Partial<ImportCourse> = {}): ImportCourse => ({
  name: '通信原理',
  weekday: 1,
  startSection: 1,
  endSection: 2,
  weeks: [1, 2, 3],
  parity: 'all',
  location: 'A101',
  teacher: '张老师',
  ...overrides,
})

const draft = (courses: ImportCourse[], source: ImportDraft['source'] = 'excel'): ImportDraft => ({
  schemaVersion: 1,
  source,
  sourceName: source === 'excel' ? '课表.xlsx' : '课表.png',
  suggestedName: '课表',
  summary: summarizeImportCourses(courses),
  warnings: [],
  courses,
})

test('parses ranges and Chinese separators into sorted unique weeks', () => {
  assert.deepEqual(parseWeeksText('1-3，5、7至8周'), [1, 2, 3, 5, 7, 8])
})

test('rejects invalid or reversed week ranges', () => {
  assert.throws(() => parseWeeksText('8-3'), /无效/)
  assert.throws(() => parseWeeksText('0, 2'), /超出/)
})

test('formats consecutive weeks as compact ranges', () => {
  assert.equal(weeksToText([5, 1, 2, 3, 5, 8]), '1-3, 5, 8')
})

test('recalculates summary after course edits', () => {
  assert.deepEqual(summarizeImportCourses([
    course(),
    course({ name: '数字信号处理', weeks: [2, 8], location: '' }),
  ]), {
    arrangements: 2,
    highestWeek: 8,
    locationCount: 1,
  })
})

test('reports invalid lesson ranges before import', () => {
  assert.deepEqual(validateImportCourse(course({ startSection: 4, endSection: 2 }), 10), ['结束节次无效'])
})

test('Excel drafts keep their existing no-review flow', () => {
  const value = draft([course()])
  assert.equal(countPendingImportFields(value), 0)
  assert.deepEqual(validateImportDraft(value, 10), [])
  assert.equal(hasBlockingImportIssues(collectImportIssues(value, 10)), false)
})

test('counts review and missing evidence and filters pending courses', () => {
  const value = draft([
    course({
      review: {
        fields: [
          { field: 'name', status: 'review', confidence: 0.61 },
          { field: 'location', status: 'missing' },
        ],
      },
    }),
    course({ name: '数字信号处理' }),
  ], 'image')
  assert.equal(countPendingImportFields(value), 1)
  assert.deepEqual(filterImportCourseIndexes(value, 'pending'), [0])
  assert.deepEqual(filterImportCourseIndexes(value, 'all'), [0, 1])
})

test('editing a field confirms its evidence and refreshes summary', () => {
  const value = draft([course({
    name: '识别错字',
    location: '',
    review: { fields: [
      { field: 'name', status: 'review' },
      { field: 'location', status: 'missing' },
    ] },
  })], 'image')
  updateImportCourseField(value, 0, 'name', '通信原理')
  updateImportCourseField(value, 0, 'location', 'A101')
  assert.equal(value.courses[0].review?.fields?.[0].status, 'confirmed')
  assert.equal(value.courses[0].review?.fields?.[1].status, 'confirmed')
  assert.equal(value.summary.locationCount, 1)
  assert.equal(countPendingImportFields(value), 0)
})

test('adds a legal blank course that blocks creation until named', () => {
  const value = draft([course()], 'image')
  const index = addBlankImportCourse(value)
  assert.equal(index, 1)
  assert.equal(value.courses[1].weekday, 1)
  assert.equal(value.courses[1].startSection, 1)
  assert.equal(value.courses[1].endSection, 1)
  assert.equal(value.courses[1].name, '')
  assert.equal(value.summary.arrangements, 2)
  assert.equal(hasBlockingImportIssues(collectImportIssues(value, 10)), true)

  updateImportCourseField(value, index, 'name', '信息论')
  assert.equal(hasBlockingImportIssues(collectImportIssues(value, 10)), false)
})

test('removes an import-only course and refreshes summary', () => {
  const value = draft([course(), course({ name: '数字信号处理', weeks: [8] })])
  removeImportCourse(value, 0)
  assert.equal(value.courses.length, 1)
  assert.equal(value.courses[0].name, '数字信号处理')
  assert.equal(value.summary.arrangements, 1)
  assert.equal(value.summary.highestWeek, 8)
})

test('detects same-week same-time conflicts as non-blocking warnings', () => {
  const value = draft([
    course({ name: '通信原理', weekday: 2, startSection: 3, endSection: 4, weeks: [1, 2] }),
    course({ name: '信息论', weekday: 2, startSection: 4, endSection: 5, weeks: [2, 3] }),
  ])
  const conflicts = detectImportConflicts(value.courses)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].severity, 'warning')
  const issues = collectImportIssues(value, 10)
  assert.equal(issues.some((issue) => issue.code === 'course.time.conflict'), true)
  assert.equal(hasBlockingImportIssues(issues), false)
  assert.deepEqual(validateImportDraft(value, 10), [])
})

test('review and required missing block while optional missing only warns', () => {
  const value = draft([course({
    review: { fields: [
      { field: 'name', status: 'review' },
      { field: 'weekday', status: 'missing' },
      { field: 'teacher', status: 'missing' },
    ] },
  })], 'image')
  const issues = collectImportIssues(value, 10)
  assert.equal(issues.filter((issue) => issue.severity === 'review').length, 2)
  assert.equal(issues.filter((issue) => issue.severity === 'warning').length, 1)
  assert.equal(hasBlockingImportIssues(issues), true)
  assert.equal(validateImportDraft(value, 10).length, 2)

  confirmCourseReview(value.courses[0])
  assert.equal(hasBlockingImportIssues(collectImportIssues(value, 10)), false)
})
