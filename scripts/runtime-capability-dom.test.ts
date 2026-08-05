const result = document.querySelector<HTMLElement>('#result')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  await import('../src/screenshot-import-controller.ts')
  await new Promise<void>((resolve) => window.setTimeout(resolve, 100))

  const excelPicker = document.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  assert(excelPicker, 'Excel import must remain in the DOM')
  assert(!excelPicker.disabled, 'Excel import must remain usable')
  assert(document.querySelector('[data-action="choose-screenshot"]') === null, 'Screenshot import must be absent')
  assert(document.querySelector('.surface-intro h3')?.textContent === '从 Excel 创建独立课表', 'Excel-only copy must remain')
}

run().then(() => {
  if (result) {
    result.dataset.status = 'pass'
    result.textContent = 'PASS'
  }
}).catch((error: unknown) => {
  if (result) {
    result.dataset.status = 'fail'
    result.textContent = `FAIL\n${String(error)}`
  }
})

export {}
