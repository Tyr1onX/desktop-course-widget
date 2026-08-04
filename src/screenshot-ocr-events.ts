import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type OcrStageEvent = {
  stage: string
  title: string
  detail: string
}

const desktopRuntime = '__TAURI_INTERNALS__' in window
const diagnosticPattern = /诊断编号[：:]\s*(OCR-[A-Z0-9-]+)/i
let latestStage: OcrStageEvent | null = null
let longRunning = false
let longRunningTimer = 0

function applyStage(): void {
  if (!latestStage) return
  const panel = document.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  if (!panel) return
  const title = panel.querySelector<HTMLElement>('[data-screenshot-import-progress-title]')
  const detail = panel.querySelector<HTMLElement>('[data-screenshot-import-progress-detail]')
  if (title) title.textContent = latestStage.title
  if (detail) {
    detail.textContent = longRunning
      ? `${latestStage.detail} 首次识别可能需要更长时间。`
      : latestStage.detail
  }
  panel.dataset.ocrRealStage = latestStage.stage
}

function beginLongRunningTimer(): void {
  window.clearTimeout(longRunningTimer)
  longRunning = false
  longRunningTimer = window.setTimeout(() => {
    longRunning = true
    applyStage()
  }, 15_000)
}

function clearStageWhenFinished(): void {
  if (document.querySelector('[data-screenshot-import-progress]')) return
  latestStage = null
  longRunning = false
  window.clearTimeout(longRunningTimer)
}

async function copyDiagnostic(button: HTMLButtonElement, diagnosticId: string): Promise<void> {
  button.disabled = true
  try {
    const summary = await invoke<string>('read_screenshot_ocr_diagnostic', { diagnosticId })
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(summary)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = summary
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.append(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    button.textContent = '诊断信息已复制'
  } catch {
    button.textContent = '复制失败'
  } finally {
    window.setTimeout(() => {
      button.disabled = false
      button.textContent = '复制诊断信息'
    }, 1800)
  }
}

function enhanceDiagnosticActions(): void {
  for (const message of document.querySelectorAll<HTMLElement>('.surface-message')) {
    const match = diagnosticPattern.exec(message.textContent ?? '')
    const existing = message.parentElement?.querySelector<HTMLButtonElement>(
      '[data-screenshot-ocr-copy-diagnostic]',
    )
    if (!match) {
      existing?.remove()
      continue
    }
    const diagnosticId = match[1].toUpperCase()
    if (existing?.dataset.diagnosticId === diagnosticId) continue
    existing?.remove()
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button screenshot-ocr-diagnostic-copy'
    button.dataset.screenshotOcrCopyDiagnostic = 'true'
    button.dataset.diagnosticId = diagnosticId
    button.textContent = '复制诊断信息'
    button.addEventListener('click', () => void copyDiagnostic(button, diagnosticId))
    message.after(button)
  }
}

const observer = new MutationObserver(() => {
  applyStage()
  clearStageWhenFinished()
  enhanceDiagnosticActions()
})
observer.observe(document.body, { childList: true, subtree: true, characterData: true })

if (desktopRuntime) {
  void listen<OcrStageEvent>('screenshot-ocr-stage', ({ payload }) => {
    latestStage = payload
    if (payload.stage === 'checking-component') beginLongRunningTimer()
    applyStage()
  })
}
