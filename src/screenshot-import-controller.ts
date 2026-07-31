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

const desktopRuntime = '__TAURI_INTERNALS__' in window
const plugin = (command: string) => `plugin:schedule-catalog|${command}`
const importTitle = '从文件创建独立课表'
const importDescription = '选择 Excel 或课表截图，识别结果会进入同一套逐项复核流程；已有课表不会被覆盖。'

let activeDraft: ImportDraft | null = null
let activeSettings: AppSettings | null = null
let importName = ''
let firstWeekMonday = ''
let recognitionPending = false
let createPending = false
let requestId = ''
let renderQueued = false

const observer = new MutationObserver(() => queueEnhance())
observer.observe(document.body, { childList: true, subtree: true })
queueEnhance()

function queueEnhance(): void {
  if (renderQueued) return
  renderQueued = true
  queueMicrotask(() => {
    renderQueued = false
    enhanceImportSurface()
  })
}

function enhanceImportSurface(): void {
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return

  if (activeDraft) {
    if (surface.dataset.screenshotImportMode !== 'review') renderReviewSurface(surface)
    return
  }

  const excelPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  if (!excelPicker) return

  const introTitle = surface.querySelector<HTMLElement>('.surface-intro h3')
  const introCopy = surface.querySelector<HTMLElement>('.surface-intro p')
  if (introTitle && introTitle.textContent !== importTitle) introTitle.textContent = importTitle
  if (introCopy && introCopy.textContent !== importDescription) introCopy.textContent = importDescription

  let screenshotPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
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

function updatePickerState(surface: HTMLElement): void {
  const excelPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  const screenshotPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  if (excelPicker) excelPicker.disabled = recognitionPending
  if (!screenshotPicker) return

  const state = `${recognitionPending}:${desktopRuntime}`
  screenshotPicker.disabled = recognitionPending
  if (screenshotPicker.dataset.screenshotImportState === state) return
  screenshotPicker.dataset.screenshotImportState = state
  screenshotPicker.innerHTML = `
    <strong>${recognitionPending ? '正在识别课表截图…' : '选择 PNG / JPG 课表截图'}</strong>
    <span>${desktopRuntime ? '图片与 OCR 全程留在本机；首次准备模型可能较慢' : '浏览器预览中不会读取本机图片'}</span>
  `
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
  setMessage(surface, '正在本机识别课表截图，首次准备 OCR 模型可能需要较长时间…')
  updatePickerState(surface)

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
    recognitionPending = false
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
      <p>${escapeHtml(draft.sourceName)} 已在本机完成识别。修改字段会自动确认，所有待确认项处理完后才能创建课表。</p>
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
    ${draft.warnings.length ? `
      <section class="import-parser-warnings">
        <strong>识别提示</strong>
        <ul>${draft.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
      </section>
    ` : ''}
    <div class="import-review-heading">
      <div><h3>逐项检查</h3><p>课程名、老师、地点、周次和单双周来自 OCR，必须人工确认。</p></div>
      <span>${draft.courses.length} 项</span>
    </div>
    <div class="import-review-list">
      <select hidden data-import-field="startSection">${lessonOptions}</select>
    </div>
    <button class="secondary-button" type="button" data-screenshot-import-reset>重新选择文件</button>
    <p class="surface-message" role="status"></p>
  `

  surface.querySelector<HTMLInputElement>('#screenshot-import-name')?.addEventListener('input', (event) => {
    importName = (event.currentTarget as HTMLInputElement).value
  })
  surface.querySelector<HTMLInputElement>('#screenshot-import-first-week')?.addEventListener('input', (event) => {
    firstWeekMonday = (event.currentTarget as HTMLInputElement).value
  })
  surface.querySelector<HTMLButtonElement>('[data-screenshot-import-reset]')?.addEventListener('click', () => {
    activeDraft = null
    activeSettings = null
    requestId = ''
    window.location.reload()
  })

  const createButton = document.querySelector<HTMLButtonElement>('[data-action="create-imported-schedule"]')
  if (createButton) {
    createButton.textContent = '确认并创建课表'
    if (createButton.dataset.screenshotImportBound !== 'true') {
      createButton.dataset.screenshotImportBound = 'true'
      createButton.addEventListener('click', (event) => {
        if (event.defaultPrevented) return
        void createScreenshotSchedule()
      })
    }
  }

  rememberImportDraft(draft)
  refreshImportDraftSummary(draft)
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
