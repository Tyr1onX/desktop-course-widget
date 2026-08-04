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
    window.__screenshotImportCommands.filter((command) => command === 'choose_and_parse_screenshot').length === 0,
    'isolating an Excel draft must not start screenshot recognition',
  )
  excelDraftMarker.remove()
  await waitFor(
    () => document.querySelectorAll('[data-action="choose-screenshot"]').length === 1,
    'the screenshot picker should return when no import draft is active',
  )

  const picker = document.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  const excelPicker = document.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  const backgroundAction = document.querySelector<HTMLButtonElement>('[data-test-background-action]')
  const courseCard = document.querySelector<HTMLButtonElement>('[data-test-course-card]')
  const closeButton = document.querySelector<HTMLButtonElement>('.surface-close')
  const sectionSelect = document.querySelector<HTMLSelectElement>('[data-import-field="startSection"]')
  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  assert(picker, 'screenshot picker should be available after the Excel draft is cleared')
  assert(excelPicker && backgroundAction && courseCard && closeButton && sectionSelect && createButton, 'busy-state fixture controls should exist')
  assert(
    window.__screenshotImportCommands.filter((command) => command === 'read_screenshot_ocr_component_status').length === 1,
    'desktop import should check the local OCR component once',
  )

  picker.click()
  await waitFor(
    () => document.querySelector('[data-screenshot-import-progress]') !== null,
    'recognition should show a progress panel',
  )
  assert(document.body.classList.contains('is-screenshot-ocr-busy'), 'recognition should lock the full settings surface')
  assert(
    document.querySelector<HTMLElement>('.import-review-surface')?.dataset.screenshotOcrBusy === 'true',
    'recognition surface should expose its busy state',
  )
  assert(document.querySelector('.screenshot-import-progress__track') === null, 'recognition should not show a fake progress bar')
  assert(
    document.querySelector('[data-screenshot-import-elapsed]')?.textContent?.includes('已用时 00:'),
    'recognition should display real elapsed time',
  )
  const cancelButton = document.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
  assert(cancelButton, 'recognition progress should provide a stop action')
  assert(cancelButton.textContent?.includes('停止识别'), 'stop action should be clearly labelled')
  assert(cancelButton.disabled === false, 'stop action should remain usable while the rest of the surface is locked')
  assert(excelPicker.disabled, 'Excel picker should be locked during screenshot recognition')
  assert(picker.disabled, 'screenshot picker should be locked during recognition')
  assert(backgroundAction.disabled, 'background toolbar actions should be locked during recognition')
  assert(courseCard.disabled, 'background course interactions should be locked during recognition')
  assert(closeButton.disabled, 'surface close action should be locked during recognition')
  assert(sectionSelect.disabled, 'review fields should be locked during recognition')
  assert(createButton.disabled, 'schedule creation should be locked during recognition')

  cancelButton.click()
  await waitFor(
    () => document.querySelector('.surface-message')?.textContent?.includes('已停止识别') === true,
    'stopped recognition should show a concise result',
  )
  assert(document.querySelector('[data-screenshot-import-progress]') === null, 'stopped recognition should remove progress UI')
  assert(!document.body.classList.contains('is-screenshot-ocr-busy'), 'stopping recognition should release the full busy lock')
  assert(
    window.__screenshotImportCommands.filter((command) => command === 'cancel_screenshot_recognition').length === 1,
    'stop action should reach the desktop command once',
  )
  await waitFor(() => picker.disabled === false, 'picker should become available again after cancellation')
  assert(excelPicker.disabled === false, 'Excel picker should be restored after cancellation')
  assert(backgroundAction.disabled === false, 'background toolbar action should be restored after cancellation')
  assert(courseCard.disabled === false, 'background course interaction should be restored after cancellation')
  assert(closeButton.disabled === false, 'surface close action should be restored after cancellation')
  assert(sectionSelect.disabled === false, 'review field should be restored after cancellation')
  assert(createButton.disabled, 'originally disabled create action should remain disabled after cancellation')

  const recognizeCallsBeforeSuccess = window.__screenshotImportCommands
    .filter((command) => command === 'choose_and_parse_screenshot').length
  picker.click()
  picker.click()
  await waitFor(
    () => document.querySelector<HTMLElement>('.import-review-surface')?.dataset.screenshotImportMode === 'review',
    'recognized screenshot should enter review mode',
  )
  await waitFor(
    () => document.querySelectorAll('.import-review-toolbar').length === 1,
    'shared review toolbar should render once',
  )

  const recognizeCalls = window.__screenshotImportCommands.filter((command) => command === 'choose_and_parse_screenshot')
  assert(
    recognizeCalls.length === recognizeCallsBeforeSuccess + 1,
    'rapid duplicate clicks must start only one additional recognizer',
  )
  assert(document.querySelector('[data-screenshot-import-progress]') === null, 'successful recognition should remove progress UI')
  assert(!document.body.classList.contains('is-screenshot-ocr-busy'), 'successful recognition should release the full busy lock')
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

  const reviewCreateButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  assert(reviewCreateButton?.disabled, 'unconfirmed OCR fields must block schedule creation')

  const confirmAll = document.querySelector<HTMLButtonElement>('[data-import-v2-confirm-all]')
  assert(confirmAll, 'bulk confirmation should be available for screenshot drafts')
  confirmAll.click()
  await waitFor(() => reviewCreateButton.disabled === false, 'bulk-confirmed review should allow schedule creation')

  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'review rerender must not duplicate toolbar')
  assert(document.querySelector('[data-import-v2-confirm-all]') === null, 'bulk confirmation should disappear after completion')
  assert(document.querySelectorAll('[data-import-v2-confirm-field]').length === 0, 'bulk confirmation should confirm all recognized fields')
  assert(document.querySelector('.surface-message')?.textContent?.includes('可以创建课表'), 'bulk confirmation should explain the next action')

  const createCallsBeforeCancel = window.__screenshotImportCommands
    .filter((command) => command.includes('create_schedule_from_import')).length
  window.confirm = () => false
  reviewCreateButton.click()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  const createCallsAfterCancel = window.__screenshotImportCommands
    .filter((command) => command.includes('create_schedule_from_import')).length
  assert(
    createCallsAfterCancel === createCallsBeforeCancel,
    'cancelling a non-blocking warning must prevent screenshot schedule creation',
  )
  assert(reviewCreateButton.disabled === false, 'cancelled warning confirmation should leave creation available')
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
