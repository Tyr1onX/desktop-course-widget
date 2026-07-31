const result = document.querySelector<HTMLElement>('#result')

declare global {
  interface Window {
    __screenshotImportCommands: string[]
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function settle(delay = 0): Promise<void> {
  await Promise.resolve()
  await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  await Promise.resolve()
}

async function run(): Promise<void> {
  await import('../src/screenshot-import-controller.ts')
  await settle()

  const screenshotPickers = document.querySelectorAll<HTMLButtonElement>('[data-action="choose-screenshot"]')
  assert(screenshotPickers.length === 1, 'screenshot picker should be inserted exactly once')
  assert(document.querySelector('.surface-intro h3')?.textContent === '从文件创建独立课表', 'shared import title should render')

  const picker = screenshotPickers[0]
  picker.click()
  picker.click()
  await settle(180)

  const recognizeCalls = window.__screenshotImportCommands.filter((command) => command === 'choose_and_parse_screenshot')
  assert(recognizeCalls.length === 1, 'rapid duplicate clicks must start only one recognizer')

  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  assert(surface?.dataset.screenshotImportMode === 'review', 'recognized screenshot should enter review mode')
  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'shared review toolbar should remain singular')
  assert(document.body.textContent?.includes('通信原理'), 'recognized course should appear in the shared review list')

  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  assert(createButton?.disabled, 'unconfirmed OCR fields must block schedule creation')

  const confirmCourse = document.querySelector<HTMLButtonElement>('[data-import-v2-confirm-course="0"]')
  assert(confirmCourse, 'course confirmation control should be available')
  confirmCourse.click()
  await settle()

  assert(document.querySelectorAll('.import-review-toolbar').length === 1, 'review rerender must not duplicate toolbar')
  assert(createButton.disabled === false, 'confirmed review should allow schedule creation')
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
