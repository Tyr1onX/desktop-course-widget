import assert from 'node:assert/strict'
import test from 'node:test'
import type { ImportCourse } from './import-draft.ts'
import { parseWeeksText, summarizeImportCourses, validateImportCourse, weeksToText } from './import-review.ts'

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
