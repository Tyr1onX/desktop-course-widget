import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isFirstWeekMonday,
  screenshotImportErrorText,
  screenshotImportLessonCount,
} from '../src/screenshot-import-policy.ts'

test('accepts only real ISO dates that fall on Monday', () => {
  assert.equal(isFirstWeekMonday('2026-09-07'), true)
  assert.equal(isFirstWeekMonday('2026-09-08'), false)
  assert.equal(isFirstWeekMonday('2026-02-30'), false)
  assert.equal(isFirstWeekMonday('2026/09/07'), false)
})

test('uses the largest configured lesson section', () => {
  assert.equal(screenshotImportLessonCount([{ section: 1 }, { section: 4 }, { section: 12 }]), 12)
  assert.equal(screenshotImportLessonCount([{ section: 0 }, { section: Number.NaN }]), 1)
})

test('preserves useful Tauri error messages without exposing object noise', () => {
  assert.equal(screenshotImportErrorText('本地 OCR 运行环境缺失'), '本地 OCR 运行环境缺失')
  assert.equal(
    screenshotImportErrorText({ error: { message: '课表截图识别超时' } }),
    '课表截图识别超时',
  )
  assert.equal(screenshotImportErrorText({ unknown: true }), '操作失败，请稍后重试。')
})
