import { invoke } from '@tauri-apps/api/core'
import type { ImportDraft } from './import-draft'
import {
  collectImportIssues,
  hasBlockingImportIssues,
  refreshImportDraftSummary,
} from './import-review'
import { rememberImportDraft } from './import-review-controller'
import {
  isFirstWeekMonday,
  screenshotImportErrorText,
  screenshotImportLessonCount,
} from './screenshot-import-policy'
import {
  canUseScreenshotImport,
  readRuntimeCapabilities,
  type RuntimeCapabilities,
} from './runtime-capabilities'

type LessonTime = {
  section: number
  start: string
  end: string
}

type AppSettings = {
  lessonTimes: LessonTime[]
  equalDuration: boolean
}

type ActiveSchedule = {
  semesterStart: string
}

type LockableControl = HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement

const plugin = (command: string) => `plugin:schedule-catalog|${command}`
const importTitle = '从文件创建独立课表'
const importDescription = '选择 Excel 或完整单张课表截图，识别结果会进入同一套复核流程；已有课表不会被覆盖。'
const reopenImportKey = 'screenshot-import:reopen-after-reset'

let runtimeCapabilities: RuntimeCapabilities | null = null
let activeDraft: ImportDraft | null = null
let activeSettings: AppSettings | null = null
let importName = ''
let firstWeekMonday = ''
let selectionPending = false
let recognitionPending = false
let recognitionStartedAt = 0
let recognitionTimer: number | null = null
let nativeDialogCleanup: (() => void) | null = null
let createPending = false
let requestId = ''
let renderQueued = false

const observer = new MutationObserver(() => queueEnhance())
observer.observe(document.body, { childList: true, subtree: true })
queueEnhance()
restoreImportSurfaceAfterReset()
void loadRuntimeCapabilities()

async function loadRuntimeCapabilities(): Promise<void> {
  runtimeCapabilities = await readRuntimeCapabilities()
  queueEnhance()
}

function queueEnhance(): void {
  if (renderQueued) return
  renderQueued = true
  queueMicrotask(() => {
    renderQueued = false
    enhanceImportSurface()
  })
}

function restoreImportSurfaceAfterReset(attempt = 0): void {
  if (sessionStorage.getItem(reopenImportKey) !== 'true') return
  if (document.querySelector('.import-review-surface')) {
    sessionStorage.removeItem(reopenImportKey)
    return
  }

  const scheduleSelector = document.querySelector<HTMLButtonElement>('[data-action="toggle-schedule-menu"]')
  if (!scheduleSelector) {
    if (attempt < 20) window.setTimeout(() => restoreImportSurfaceAfterReset(attempt + 1), 50)
    return
  }

  scheduleSelector.click()
  window.setTimeout(() => {
    const importCommand = document.querySelector<HTMLButtonElement>('[data-open-surface="import"]')
    if (importCommand) {
      sessionStorage.removeItem(reopenImportKey)
      importCommand.click()
      return
    }
    if (attempt < 20) restoreImportSurfaceAfterReset(attempt + 1)
  }, 0)
}

function enhanceImportSurface(): void {
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return

  if (activeDraft) {
    if (surface.dataset.screenshotImportMode !== 'review') renderReviewSurface(surface)
    hideTechnicalReviewEvidence(surface)
    return
  }

  const excelPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  if (!excelPicker) return

  const existingExcelReview = Boolean(
    surface.querySelector('[data-import-course-details], .import-course-review'),
  )
  const existingScreenshotPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  if (existingExcelReview || !canUseScreenshotImport(runtimeCapabilities)) {
    existingScreenshotPicker?.remove()
    return
  }

  const introTitle = surface.querySelector<HTMLElement>('.surface-intro h3')
  const introCopy = surface.querySelector<HTMLElement>('.surface-intro p')
  if (introTitle && introTitle.textContent !== importTitle) introTitle.textContent = importTitle
  if (introCopy && introCopy.textContent !== importDescription) introCopy.textContent = importDescription

  let screenshotPicker = existingScreenshotPicker
  if (!screenshotPicker) {
    screenshotPicker = document.createElement('button')
    screenshotPicker.className = 'import-picker'
    screenshotPicker.type = 'button'
    screenshotPicker.dataset.action = 'choose-screenshot'
    excelPicker.after(screenshotPicker)
  }
  if (screenshotPicker.dataset.screenshotImportBound !== 'true') {
    screenshotPicker.dataset.screenshotImportBound = 'true'
    screenshotPicker.addEventListener('click', () => void chooseScreenshot())
  }
  updatePickerState(surface)
}

function recognitionElapsedSeconds(): number {
  if (!recognitionPending || recognitionStartedAt <= 0) return 0
  return Math.max(0, Math.floor((performance.now() - recognitionStartedAt) / 1000))
}

function updatePickerState(surface: HTMLElement): void {
  const excelPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  const screenshotPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  const pending = selectionPending || recognitionPending
  if (excelPicker) excelPicker.disabled = pending
  if (!screenshotPicker) return

  const elapsedSeconds = recognitionElapsedSeconds()
  const state = `${selectionPending}:${recognitionPending}:${elapsedSeconds}`
  screenshotPicker.disabled = pending
  if (screenshotPicker.dataset.screenshotImportState === state) return
  screenshotPicker.dataset.screenshotImportState = state

  if (selectionPending) {
    screenshotPicker.innerHTML = '<strong>正在选择课表截图…</strong>'
    return
  }
  if (recognitionPending) {
    screenshotPicker.innerHTML = `<strong>正在识别课表 · ${elapsedSeconds} 秒</strong>`
    return
  }
  screenshotPicker.innerHTML = `
    <strong>选择 PNG / JPG 课表截图</strong>
    <span>请使用完整单张截图，包含星期标题、节次和全部课程；暂不支持多图拼接</span>
  `
}

function stopRecognitionClock(): void {
  if (recognitionTimer !== null) {
    window.clearInterval(recognitionTimer)
    recognitionTimer = null
  }
  recognitionStartedAt = 0
}

function startRecognitionClock(): void {
  stopRecognitionClock()
  recognitionStartedAt = performance.now()
  const tick = () => {
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface && recognitionPending) updatePickerState(currentSurface)
  }
  tick()
  recognitionTimer = window.setInterval(tick, 1000)
}

function setRecognitionBusy(surface: HTMLElement, busy: boolean): void {
  recognitionPending = busy
  if (busy) startRecognitionClock()
  else stopRecognitionClock()

  document.documentElement.classList.toggle('screenshot-import-busy', busy)
  surface.toggleAttribute('aria-busy', busy)
  document.querySelectorAll<LockableControl>('button, input, select, textarea').forEach((control) => {
    if (busy) {
      if (control.dataset.screenshotOcrWasDisabled === undefined) {
        control.dataset.screenshotOcrWasDisabled = control.disabled ? 'true' : 'false'
      }
      control.disabled = true
      return
    }
    const previous = control.dataset.screenshotOcrWasDisabled
    if (previous !== undefined) {
      control.disabled = previous === 'true'
      delete control.dataset.screenshotOcrWasDisabled
    }
  })
  updatePickerState(surface)
}

function stopWatchingNativeDialog(): void {
  nativeDialogCleanup?.()
  nativeDialogCleanup = null
}

function watchNativeDialog(surface: HTMLElement): void {
  stopWatchingNativeDialog()
  let focusLeftWindow = false

  const onBlur = () => {
    if (selectionPending) focusLeftWindow = true
  }
  const onFocus = () => {
    if (!selectionPending || !focusLeftWindow) return
    selectionPending = false
    setMessage(surface, '正在本机识别课表截图…')
    setRecognitionBusy(surface, true)
    stopWatchingNativeDialog()
  }
  const cleanup = () => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
  }

  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  nativeDialogCleanup = cleanup
}

async function chooseScreenshot(): Promise<void> {
  if (selectionPending || recognitionPending || !canUseScreenshotImport(runtimeCapabilities)) return
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return

  selectionPending = true
  setMessage(surface, '')
  updatePickerState(surface)
  watchNativeDialog(surface)

  try {
    const draft = await invoke<ImportDraft | null>('choose_and_parse_screenshot')
    if (!draft) {
      setMessage(surface, '已取消选择课表截图。')
      return
    }

    const [settings, schedule] = await Promise.all([
      invoke<AppSettings>('read_app_settings'),
      invoke<ActiveSchedule>('read_schedule'),
    ])
    activeSettings = settings
    activeDraft = draft
    importName = draft.suggestedName
    firstWeekMonday = schedule.semesterStart
    requestId = ''
    refreshImportDraftSummary(draft)
    renderReviewSurface(surface)
  } catch (error) {
    setMessage(surface, screenshotImportErrorText(error))
  } finally {
    stopWatchingNativeDialog()
    selectionPending = false
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface && recognitionPending) setRecognitionBusy(currentSurface, false)
    else if (currentSurface && !activeDraft) updatePickerState(currentSurface)
    else stopRecognitionClock()
  }
}

function renderReviewSurface(surface: HTMLElement): void {
  const draft = activeDraft
  const settings = activeSettings
  if (!draft || !settings) return

  surface.dataset.screenshotImportMode = 'review'
  const lessonCount = screenshotImportLessonCount(settings.lessonTimes)
  const issues = collectImportIssues(draft, lessonCount)
  const pendingCount = issues.filter((issue) => issue.severity !== 'warning').length
  const lessonOptions = settings.lessonTimes
    .map((time) => `<option value="${time.section}">${time.section}</option>`)
    .join('')

  surface.innerHTML = `
    <div class="surface-intro">
      <h3>检查截图识别结果</h3>
    </div>
    <div class="import-summary">
      <div><span>课程安排</span><strong>${draft.summary.arrangements} 项</strong></div>
      <div><span>最高教学周</span><strong>${draft.summary.highestWeek} 周</strong></div>
      <div><span>待确认</span><strong>${pendingCount} 项</strong></div>
    </div>
    <div class="import-basics">
      <label class="field field--full"><span>课表名称</span><input id="screenshot-import-name" value="${escapeHtml(importName)}" /></label>
      <label class="field field--full"><span>第一周星期一</span><input id="screenshot-import-first-week" type="date" value="${escapeHtml(firstWeekMonday)}" /></label>
    </div>
    <div class="import-review-heading">
      <div><h3>逐项检查</h3></div>
      <span>${draft.courses.length} 项</span>
    </div>
    <div class="import-review-list">
      <select hidden data-import-field="startSection">${lessonOptions}</select>
    </div>
    <p class="surface-message" role="status"></p>
  `

  surface.querySelector<HTMLInputElement>('#screenshot-import-name')?.addEventListener('input', (event) => {
    importName = (event.currentTarget as HTMLInputElement).value
  })
  surface.querySelector<HTMLInputElement>('#screenshot-import-first-week')?.addEventListener('input', (event) => {
    firstWeekMonday = (event.currentTarget as HTMLInputElement).value
  })

  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  if (createButton) {
    createButton.textContent = '确认并创建课表'
    let resetButton = document.querySelector<HTMLButtonElement>('[data-screenshot-import-reset]')
    if (!resetButton) {
      resetButton = document.createElement('button')
      resetButton.className = 'secondary-button'
      resetButton.type = 'button'
      resetButton.dataset.screenshotImportReset = 'true'
      resetButton.textContent = '重新选择图片'
      createButton.before(resetButton)
    }
    if (resetButton.dataset.screenshotImportBound !== 'true') {
      resetButton.dataset.screenshotImportBound = 'true'
      resetButton.addEventListener('click', resetScreenshotImport)
    }
    if (createButton.dataset.screenshotImportBound !== 'true') {
      createButton.dataset.screenshotImportBound = 'true'
      createButton.addEventListener('click', (event) => {
        queueMicrotask(() => {
          if (event.defaultPrevented) return
          void createScreenshotSchedule()
        })
      })
    }
  }

  rememberImportDraft(draft)
  refreshImportDraftSummary(draft)
}

function resetScreenshotImport(): void {
  if (!window.confirm('放弃当前识别结果并重新选择图片？')) return
  activeDraft = null
  activeSettings = null
  importName = ''
  firstWeekMonday = ''
  selectionPending = false
  recognitionPending = false
  stopRecognitionClock()
  stopWatchingNativeDialog()
  createPending = false
  requestId = ''
  sessionStorage.setItem(reopenImportKey, 'true')
  window.location.reload()
}

function hideTechnicalReviewEvidence(surface: HTMLElement): void {
  surface
    .querySelectorAll('.import-evidence-copy, .surface-intro p, .import-review-heading p')
    .forEach((element) => element.remove())
}

async function createScreenshotSchedule(): Promise<void> {
  const draft = activeDraft
  const settings = activeSettings
  if (!draft || !settings || createPending) return

  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  const button = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  if (!surface || !button) return

  try {
    const name = importName.trim()
    if (!name) throw new Error('请填写课表名称')
    if (!isFirstWeekMonday(firstWeekMonday)) throw new Error('请选择星期一作为第一周开始日期')

    const lessonCount = screenshotImportLessonCount(settings.lessonTimes)
    const issues = collectImportIssues(draft, lessonCount)
    if (hasBlockingImportIssues(issues)) throw new Error('仍有课程字段需要修正或确认')

    createPending = true
    button.disabled = true
    setMessage(surface, '正在创建课表…')
    if (!requestId) requestId = crypto.randomUUID()
    await invoke(plugin('create_schedule_from_import'), {
      request: {
        name,
        firstWeekMonday,
        draft,
        times: settings.lessonTimes,
        equalDuration: settings.equalDuration,
        requestId,
      },
    })
    setMessage(surface, '课表已创建。')
    window.location.reload()
  } catch (error) {
    setMessage(surface, screenshotImportErrorText(error))
  } finally {
    createPending = false
    if (activeDraft) {
      const lessonCount = screenshotImportLessonCount(settings.lessonTimes)
      button.disabled = hasBlockingImportIssues(collectImportIssues(activeDraft, lessonCount))
    }
  }
}

function setMessage(surface: HTMLElement, message: string): void {
  const target = surface.querySelector<HTMLElement>('.surface-message')
  if (target) target.textContent = message
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
