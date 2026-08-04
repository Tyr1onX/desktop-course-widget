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

type OcrComponentStatus = {
  state: 'ready' | 'missing' | 'corrupt' | 'runtime-failed' | 'unavailable'
  componentVersion: string | null
  source: string | null
  message: string
  canPrepare: boolean
}

const desktopRuntime = '__TAURI_INTERNALS__' in window
const plugin = (command: string) => `plugin:schedule-catalog|${command}`
const importTitle = '从文件创建独立课表'
const importDescription = '选择 Excel 或完整单张课表截图，识别结果会进入同一套复核流程；已有课表不会被覆盖。'
const reopenImportKey = 'screenshot-import:reopen-after-reset'

let activeDraft: ImportDraft | null = null
let activeSettings: AppSettings | null = null
let importName = ''
let firstWeekMonday = ''
let recognitionPending = false
let recognitionCancelPending = false
let recognitionElapsedTimer = 0
let recognitionStartedAt = 0
let componentPending = false
let componentStatusRequested = false
let ocrComponentStatus: OcrComponentStatus | null = null
let createPending = false
let requestId = ''
let renderQueued = false

const observer = new MutationObserver(() => queueEnhance())
observer.observe(document.body, { childList: true, subtree: true })
queueEnhance()
restoreImportSurfaceAfterReset()

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
  if (existingExcelReview) {
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
    screenshotPicker.addEventListener('click', () => void handleScreenshotPicker())
  }
  updatePickerState(surface)
  ensureOcrComponentStatus(surface)
}

function updatePickerState(surface: HTMLElement): void {
  const excelPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  const screenshotPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  const checking = desktopRuntime && componentStatusRequested && !ocrComponentStatus
  const componentState = ocrComponentStatus?.state
  const blocked = componentState === 'unavailable' || componentState === 'runtime-failed'
  if (excelPicker) excelPicker.disabled = recognitionPending || componentPending
  if (!screenshotPicker) return

  const state = `${recognitionPending}:${componentPending}:${checking}:${componentState ?? 'unknown'}:${desktopRuntime}`
  screenshotPicker.disabled = recognitionPending || componentPending || checking || blocked
  if (screenshotPicker.dataset.screenshotImportState === state) return
  screenshotPicker.dataset.screenshotImportState = state

  let title = '选择 PNG / JPG 课表截图'
  let detail = desktopRuntime
    ? '请使用完整单张截图，包含星期标题、节次和全部课程；暂不支持多图拼接'
    : '浏览器预览中不会读取本机图片'
  if (recognitionPending) {
    title = '正在识别课表截图…'
    detail = '图片只在本机处理，请稍候'
  } else if (componentPending) {
    title = componentState === 'corrupt' ? '正在修复本地识别组件…' : '正在准备本地识别组件…'
    detail = '首次准备可能需要一些时间，完成后可离线识别'
  } else if (checking) {
    title = '正在检查本地识别组件…'
    detail = '图片不会上传'
  } else if (componentState === 'missing' || componentState === 'corrupt') {
    title = componentState === 'corrupt' ? '修复本地识别组件' : '准备本地识别组件'
    detail = ocrComponentStatus?.message ?? '完成准备后可离线识别课表截图'
  } else if (componentState === 'runtime-failed') {
    title = '本地识别运行时检查失败'
    detail = ocrComponentStatus?.message ?? '请复制诊断信息后反馈'
  } else if (componentState === 'unavailable') {
    title = '当前安装包暂不支持截图识别'
    detail = ocrComponentStatus?.message ?? '请安装支持离线识别组件的版本'
  }
  screenshotPicker.innerHTML = `<strong>${title}</strong><span>${escapeHtml(detail)}</span>`
}

function ensureOcrComponentStatus(surface: HTMLElement): void {
  if (!desktopRuntime || componentStatusRequested) return
  componentStatusRequested = true
  updatePickerState(surface)
  void refreshOcrComponentStatus(surface)
}

async function refreshOcrComponentStatus(surface: HTMLElement): Promise<void> {
  try {
    ocrComponentStatus = await invoke<OcrComponentStatus>('read_screenshot_ocr_component_status')
  } catch (error) {
    ocrComponentStatus = {
      state: 'unavailable',
      componentVersion: null,
      source: null,
      message: screenshotImportErrorText(error),
      canPrepare: false,
    }
  }
  updatePickerState(surface)
}

async function handleScreenshotPicker(): Promise<void> {
  if (recognitionPending || componentPending) return
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return
  if (!desktopRuntime) {
    setMessage(surface, '浏览器预览不会读取本机图片，请在桌面应用中测试。')
    return
  }
  if (!ocrComponentStatus) {
    await refreshOcrComponentStatus(surface)
    return
  }
  if (ocrComponentStatus.state !== 'ready') {
    if (ocrComponentStatus.canPrepare) {
      await prepareOcrComponent(surface)
    } else {
      setMessage(surface, ocrComponentStatus.message)
    }
    return
  }
  await chooseScreenshot()
}

async function prepareOcrComponent(surface: HTMLElement): Promise<void> {
  componentPending = true
  setMessage(surface, ocrComponentStatus?.state === 'corrupt'
    ? '正在修复本地识别组件…'
    : '正在准备本地识别组件…')
  updatePickerState(surface)
  try {
    ocrComponentStatus = await invoke<OcrComponentStatus>('prepare_screenshot_ocr_component')
    setMessage(surface, '本地识别组件已准备完成，可以选择课表截图。')
  } catch (error) {
    setMessage(surface, screenshotImportErrorText(error))
    await refreshOcrComponentStatus(surface)
  } finally {
    componentPending = false
    updatePickerState(surface)
  }
}


function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

function updateRecognitionElapsed(): void {
  const target = document.querySelector<HTMLElement>('[data-screenshot-import-elapsed]')
  if (!target || recognitionStartedAt === 0) return
  const seconds = Math.max(0, (Date.now() - recognitionStartedAt) / 1000)
  target.textContent = `已用时 ${formatElapsed(seconds)}`
}

function setRecognitionBusyState(busy: boolean): void {
  document.body.classList.toggle('is-screenshot-ocr-busy', busy)
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (surface) {
    surface.toggleAttribute('aria-busy', busy)
    surface.dataset.screenshotOcrBusy = busy ? 'true' : 'false'
  }
  const controls = document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('button, input, select, textarea')
  for (const control of controls) {
    if (control.matches('[data-screenshot-import-cancel]')) continue
    if (busy) {
      if (!control.disabled) {
        control.disabled = true
        control.dataset.screenshotOcrDisabled = 'true'
      }
    } else if (control.dataset.screenshotOcrDisabled === 'true') {
      control.disabled = false
      delete control.dataset.screenshotOcrDisabled
    }
  }
}

function showRecognitionProgress(surface: HTMLElement): void {
  let panel = surface.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'screenshot-import-progress'
    panel.dataset.screenshotImportProgress = 'true'
    panel.setAttribute('aria-live', 'polite')
    panel.innerHTML = `
      <div class="screenshot-import-progress__heading">
        <div>
          <strong data-screenshot-import-progress-title>正在准备本地识别器…</strong>
          <span data-screenshot-import-elapsed>已用时 00:00</span>
        </div>
        <button class="screenshot-import-progress__cancel" type="button" data-screenshot-import-cancel>停止识别</button>
      </div>
      <p data-screenshot-import-progress-detail>图片只在本机处理，不会上传。</p>
    `
    const message = surface.querySelector('.surface-message')
    if (message) message.before(panel)
    else surface.append(panel)
    panel.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
      ?.addEventListener('click', () => void cancelScreenshotRecognition())
  }
  recognitionStartedAt = Date.now()
  window.clearInterval(recognitionElapsedTimer)
  recognitionElapsedTimer = window.setInterval(updateRecognitionElapsed, 1_000)
  updateRecognitionElapsed()
  updateRecognitionProgress('正在准备本地识别器…', '图片只在本机处理，不会上传。')
  setRecognitionBusyState(true)
}

function updateRecognitionProgress(title: string, detail: string): void {
  const panel = document.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  const titleTarget = panel?.querySelector<HTMLElement>('[data-screenshot-import-progress-title]')
  const detailTarget = panel?.querySelector<HTMLElement>('[data-screenshot-import-progress-detail]')
  if (titleTarget) titleTarget.textContent = title
  if (detailTarget) detailTarget.textContent = detail
}

function hideRecognitionProgress(): void {
  window.clearInterval(recognitionElapsedTimer)
  recognitionElapsedTimer = 0
  recognitionStartedAt = 0
  document.querySelector('[data-screenshot-import-progress]')?.remove()
}

async function cancelScreenshotRecognition(): Promise<void> {
  if (!recognitionPending || recognitionCancelPending) return
  recognitionCancelPending = true
  updateRecognitionProgress('正在停止识别…', '正在结束本地识别进程并清理临时文件。')
  const button = document.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
  if (button) {
    button.disabled = true
    button.textContent = '正在停止…'
  }
  try {
    const accepted = await invoke<boolean>('cancel_screenshot_recognition')
    if (!accepted && recognitionPending) {
      updateRecognitionProgress('识别即将完成…', '正在生成复核结果，请稍候。')
    }
  } catch (error) {
    recognitionCancelPending = false
    if (button) {
      button.disabled = false
      button.textContent = '停止识别'
    }
    const surface = document.querySelector<HTMLElement>('.import-review-surface')
    if (surface) setMessage(surface, screenshotImportErrorText(error))
  }
}

async function chooseScreenshot(): Promise<void> {
  if (recognitionPending) return
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return
  if (!desktopRuntime) {
    setMessage(surface, '浏览器预览不会读取本机图片，请在桌面应用中测试。')
    return
  }

  recognitionPending = true
  recognitionCancelPending = false
  setMessage(surface, '')
  showRecognitionProgress(surface)
  updatePickerState(surface)

  try {
    const draft = await invoke<ImportDraft | null>('choose_and_parse_screenshot')
    if (!draft) {
      setMessage(surface, '已取消选择课表截图。')
      return
    }

    updateRecognitionProgress('正在整理课程信息…', '正在组合课程名、周次、节次、地点和教师。')
    const [settings, schedule] = await Promise.all([
      invoke<AppSettings>('read_app_settings'),
      invoke<ActiveSchedule>('read_schedule'),
    ])
    updateRecognitionProgress('正在生成复核结果…', '即将打开课程检查页面。')
    activeSettings = settings
    activeDraft = draft
    importName = draft.suggestedName
    firstWeekMonday = schedule.semesterStart
    requestId = ''
    refreshImportDraftSummary(draft)
    renderReviewSurface(surface)
  } catch (error) {
    const message = screenshotImportErrorText(error)
    setMessage(surface, message.includes('已取消') || message.includes('已停止') ? '已停止识别。' : message)
  } finally {
    recognitionPending = false
    recognitionCancelPending = false
    setRecognitionBusyState(false)
    hideRecognitionProgress()
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface && !activeDraft) updatePickerState(currentSurface)
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
      <p>${escapeHtml(draft.sourceName)} 已在本机完成识别。请先核对课程数量和摘要；可以随时放弃本次结果并重新选择图片。</p>
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
      <div><h3>逐项检查</h3><p>先浏览课程摘要；整体无误可一次确认全部，只有异常项需要展开修改。</p></div>
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
  recognitionPending = false
  createPending = false
  requestId = ''
  sessionStorage.setItem(reopenImportKey, 'true')
  window.location.reload()
}

function hideTechnicalReviewEvidence(surface: HTMLElement): void {
  surface.querySelectorAll('.import-evidence-copy').forEach((element) => element.remove())
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
