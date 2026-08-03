import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isFirstWeekMonday,
  screenshotImportErrorText,
  screenshotImportLessonCount,
} from '../src/screenshot-import-policy.ts'

const noCourseMessage = '未能从这张图片中识别出课表。请使用包含星期标题、节次和全部课程的完整截图后重试。'

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

test('preserves short actionable validation messages', () => {
  assert.equal(screenshotImportErrorText('请填写课表名称'), '请填写课表名称')
  assert.equal(
    screenshotImportErrorText({ error: { message: '仍有课程字段需要修正或确认' } }),
    '仍有课程字段需要修正或确认',
  )
})

test('maps noisy OCR no-course output to a concise user message', () => {
  const noisy = [
    '\u001b[32mCreating model: PP-OCRv6_medium_rec\u001b[0m',
    'Model files already exist at C:\\Users\\30593\\.paddlex\\official_models',
    'screenshot-import failed: 整图 OCR 已完成，但未形成课程记录：未可靠找到星期表头',
  ].join(' · ')
  const message = screenshotImportErrorText(noisy)
  assert.equal(message, noCourseMessage)
  assert.equal(message.includes('30593'), false)
  assert.equal(message.includes('Paddle'), false)
})

test('maps common runtime failures without exposing implementation details', () => {
  assert.equal(
    screenshotImportErrorText('PaddleOCR is not installed'),
    '本地截图识别器启动失败，请稍后重试；无需重新安装或重启应用。',
  )
  assert.equal(
    screenshotImportErrorText({ detail: 'operation timed out while invoking python.exe' }),
    '课表截图识别超时，请尝试使用更清晰或尺寸更小的图片。',
  )
  assert.equal(
    screenshotImportErrorText('cannot identify image file'),
    '无法读取这张图片，请选择有效的 PNG、JPG 或 JPEG 文件。',
  )
})

test('hides unknown technical diagnostics and keeps harmless short messages', () => {
  assert.equal(
    screenshotImportErrorText('warnings.warn: model cache at C:\\Users\\name\\.paddlex'),
    '课表截图识别失败，请稍后重试。',
  )
  assert.equal(screenshotImportErrorText('保存失败，请重试'), '保存失败，请重试')
  assert.equal(screenshotImportErrorText({ unknown: true }), '操作失败，请稍后重试。')
})
