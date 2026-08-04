const result = document.querySelector<HTMLElement>('#result')

declare global {
  interface Window {
    __screenshotImportCommands: string[]
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(condition: () => boolean, message: string, timeout = 3_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await Promise.resolve()
    if (condition()) return
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25))
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  await import('../src/screenshot-import-controller.ts')
  await waitFor(
    () => document.querySelectorAll('[data-action="choose-screenshot"]').length === 1,
    'screenshot picker should be inserted exactly once',
  )

  const screenshotPickers = document.querySelectorAll<HTMLButtonElement>('[data-action="choose-screenshot"]')
  assert(screenshotPickers.length === 1, 'screenshot picker should be inserted exactly once')
  assert(document.querySelector('.surface-intro h3')?.textContent === '从文件创建独立课表', 'shared import title should render')
  assert(
    screenshotPickers[0].textContent?.includes('完整单张截图'),
    'screenshot picker should explain that one complete image is required',
  )
  assert(
    screenshotPickers[0].textContent?.includes('暂不支持多图拼接'),
    'screenshot picker should state the current multi-image limitation',
  )

  const reviewList = document.querySelector<HTMLElement>('.import-review-list')
  assert(reviewList, 'import review list should exist')
  const excelDraftMarker = document.createElement('details')
  excelDraftMarker.dataset.importCourseDetails = '0'
  reviewList.append(excelDraftMarker)
  await waitFor(
    () => document.querySelector('[data-action="choose-screenshot"]') === null,
    'an active Excel draft should hide the screenshot source picker',
  )
  assert(
    window.__screenshotImportCommands.length === 0,
    'isolating an Excel draft must not start screenshot recognition',
  )
  excelDraftMarker.remove()
  await waitFor(
    () => document.querySelectorAll('[data-action="choose-screenshot"]').length === 1,
    'the screenshot picker should return when no import draft is active',
  )

  const picker = document.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  const excelPicker = document.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  assert(picker, 'screenshot picker should be available after the Excel draft is cleared')
  assert(excelPicker, 'Excel picker should be available before recognition')
  const unrelatedControl = document.createElement('button')
  unrelatedControl.type = 'button'
  unrelatedControl.textContent = 'unrelated control'
  document.body.append(unrelatedControl)

  picker.click()
  assert(picker.textContent?.includes('正在选择课表截图'), 'file selection should have a distinct state')
  assert(!picker.textContent?.includes('秒'), 'file selection time must not count as OCR time')
  picker.click()
  await waitFor(
    () => document.documentElement.classList.contains('screenshot-import-busy'),
    'recognition should start only after a file path is returned',
  )
  assert(picker.disabled, 'screenshot picker must be disabled while OCR is running')
  assert(excelPicker.disabled, 'Excel picker must be disabled while OCR is running')
  assert(unrelatedControl.disabled, 'controls outside the import card must be disabled while OCR is running')
  assert(/正在识别课表 · \d+ 秒/.test(picker.textContent ?? ''), 'busy picker should show whole elapsed seconds')
  assert(!picker.textContent?.includes('.'), 'busy picker should update in whole-second steps')
  assert(!picker.textContent?.includes('%'), 'busy picker must not show a fake percentage')

  await waitFor(
    () => document.querySelector<HTMLElement>('.import-review-surface')?.dataset.screenshotImportMode === 'review',
    'recognized screenshot should enter review mode',
  )
  await waitFor(
    () => document.querySelectorAll('.import-review-toolbar').length === 1,
    'shared review toolbar should render once',
  )
  assert(!document.documentElement.classList.contains('screenshot-import-busy'), 'recognition lock should clear after OCR finishes')
  assert(!unrelatedControl.disabled, 'unrelated controls should restore their prior enabled state after OCR')
  unrelatedControl.remove()

  const chooseCalls = window.__screenshotImportCommands.filter((command) => command === 'choose_screenshot')
  const parseCalls = window.__screenshotImportCommands.filter((command) => command === 'parse_screenshot')
  assert(chooseCalls.length === 1, 'rapid duplicate clicks must open only one file picker')
  assert(parseCalls.length === 1, 'one selected image must start only one recognizer')
  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'shared review toolbar should remain singular')
  assert(document.body.textContent?.includes('通信原理'), 'recognized course should appear in the shared review list')
  assert(document.body.textContent?.includes('地点：南湖-第一教学楼-四阶'), 'collapsed summary should expose recognized location before bulk confirmation')
  assert(document.body.textContent?.includes('老师：未识别'), 'collapsed summary should expose missing optional teacher before bulk confirmation')
  assert(document.querySelector('.import-parser-warnings') === null, 'successful screenshot review should hide internal OCR parser diagnostics')
  await waitFor(
    () => document.querySelectorAll('.import-evidence-copy').length === 0,
    'screenshot review should hide confidence, raw OCR, and parser-rule evidence',
  )
  assert(!document.body.textContent?.includes('置信度'), 'screenshot review should not expose confidence diagnostics')
  assert(!document.body.textContent?.includes('原文：'), 'screenshot review should not expose raw OCR diagnostics')
  assert(!document.body.textContent?.includes('规则解析'), 'screenshot review should not expose parser implementation details')
  assert(document.querySelectorAll<HTMLDetailsElement>('.import-course-review[open]').length === 0, 'image courses should start collapsed for quick scanning')

  const resetButton = document.querySelector<HTMLButtonElement>('[data-screenshot-import-reset]')
  assert(resetButton, 'review footer should provide a restart action without creating a schedule')
  assert(resetButton.textContent?.includes('重新选择图片'), 'restart action should be clear to users')

  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  assert(createButton?.disabled, 'unconfirmed OCR fields must block schedule creation')

  const confirmAll = document.querySelector<HTMLButtonElement>('[data-import-v2-confirm-all]')
  assert(confirmAll, 'bulk confirmation should be available for screenshot drafts')
  confirmAll.click()
  await waitFor(() => createButton.disabled === false, 'bulk-confirmed review should allow schedule creation')

  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'review rerender must not duplicate toolbar')
  assert(document.querySelector('[data-import-v2-confirm-all]') === null, 'bulk confirmation should disappear after completion')
  assert(document.querySelectorAll('[data-import-v2-confirm-field]').length === 0, 'bulk confirmation should confirm all recognized fields')
  assert(document.querySelector('.surface-message')?.textContent?.includes('可以创建课表'), 'bulk confirmation should explain the next action')

  const createCallsBeforeCancel = window.__screenshotImportCommands
    .filter((command) => command.includes('create_schedule_from_import')).length
  window.confirm = () => false
  createButton.click()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  const createCallsAfterCancel = window.__screenshotImportCommands
    .filter((command) => command.includes('create_schedule_from_import')).length
  assert(
    createCallsAfterCancel === createCallsBeforeCancel,
    'cancelling a non-blocking warning must prevent screenshot schedule creation',
  )
  assert(createButton.disabled === false, 'cancelled warning confirmation should leave creation available')
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

export {}
