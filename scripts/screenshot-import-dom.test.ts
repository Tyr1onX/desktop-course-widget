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

  const picker = screenshotPickers[0]
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
  assert(recognizeCalls.length === 1, 'rapid duplicate clicks must start only one recognizer')
  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'shared review toolbar should remain singular')
  assert(document.body.textContent?.includes('通信原理'), 'recognized course should appear in the shared review list')

  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  assert(createButton?.disabled, 'unconfirmed OCR fields must block schedule creation')

  const confirmCourse = document.querySelector<HTMLButtonElement>('[data-import-v2-confirm-course="0"]')
  assert(confirmCourse, 'course confirmation control should be available')
  confirmCourse.click()
  await waitFor(() => createButton.disabled === false, 'confirmed review should allow schedule creation')

  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'review rerender must not duplicate toolbar')
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
