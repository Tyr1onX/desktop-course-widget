import { invoke } from '@tauri-apps/api/core'

type SectionTime = {
  section: number
  start: string
  end: string
}

type AppSettings = {
  schemaVersion: number
  onboardingCompleted: boolean
  lessonTimes: SectionTime[]
  equalDuration: boolean
}

const isDesktopRuntime = '__TAURI_INTERNALS__' in window
let autosaveTimer: number | undefined

function showMessage(message: string): void {
  const target = document.querySelector<HTMLElement>('#times-message')
  if (target) target.textContent = message
}

function timeToMinutes(value: string): number | null {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function collectLessonTimes(): SectionTime[] {
  return Array.from({ length: 10 }, (_, index) => {
    const section = index + 1
    const start = document.querySelector<HTMLInputElement>(`[data-time-role="start"][data-lesson="${section}"]`)?.value ?? ''
    const end = document.querySelector<HTMLInputElement>(`[data-time-role="end"][data-lesson="${section}"]`)?.value ?? ''
    const startMinutes = timeToMinutes(start)
    const endMinutes = timeToMinutes(end)
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      throw new Error(`第 ${section} 节的作息时间无效`)
    }
    return { section, start, end }
  })
}

function applySettings(settings: AppSettings): void {
  for (const item of settings.lessonTimes) {
    const start = document.querySelector<HTMLInputElement>(`[data-time-role="start"][data-lesson="${item.section}"]`)
    const end = document.querySelector<HTMLInputElement>(`[data-time-role="end"][data-lesson="${item.section}"]`)
    if (start) start.value = item.start
    if (end) end.value = item.end
  }
  const equalDuration = document.querySelector<HTMLInputElement>('#equal-duration')
  if (equalDuration) equalDuration.checked = settings.equalDuration

  if (!settings.onboardingCompleted) {
    const badge = document.querySelector<HTMLElement>('.status-badge')
    if (badge) badge.textContent = '首次设置'
    const importMessage = document.querySelector<HTMLElement>('#import-message')
    if (importMessage && !importMessage.textContent?.trim()) {
      importMessage.textContent = '首次使用：选择学校导出的 Excel 课表，确认第一周日期后直接应用即可。'
    }
  }
}

async function persistLessonTimes(successMessage?: string): Promise<void> {
  try {
    const settings = await invoke<AppSettings>('save_lesson_times', {
      request: {
        times: collectLessonTimes(),
        equalDuration: document.querySelector<HTMLInputElement>('#equal-duration')?.checked ?? false,
      },
    })
    if (successMessage) {
      showMessage(successMessage)
    } else {
      showMessage(
        settings.equalDuration
          ? '作息已自动保存，并保持每节课时长相同。'
          : '作息已自动保存。',
      )
    }
  } catch (error) {
    showMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function queueAutosave(): void {
  if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = undefined
    void persistLessonTimes()
  }, 350)
}

async function initialize(): Promise<void> {
  if (!isDesktopRuntime) return
  if (!document.querySelector('#save-times')) {
    requestAnimationFrame(() => void initialize())
    return
  }

  try {
    applySettings(await invoke<AppSettings>('read_app_settings'))
  } catch (error) {
    showMessage(`读取作息设置失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const saveButton = document.querySelector<HTMLButtonElement>('#save-times')
  saveButton?.addEventListener(
    'click',
    (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      void persistLessonTimes('作息时间已保存。重启后仍会保留，并用于后续导入。')
    },
    true,
  )

  for (const input of document.querySelectorAll<HTMLInputElement>('.time-input')) {
    input.addEventListener('change', queueAutosave)
  }

  document.querySelector<HTMLInputElement>('#equal-duration')?.addEventListener('change', () => {
    queueMicrotask(queueAutosave)
  })

  document.querySelector<HTMLButtonElement>('#restore-times')?.addEventListener('click', () => {
    queueMicrotask(() => {
      if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer)
      autosaveTimer = undefined
      void persistLessonTimes('已恢复默认作息并保存。')
    })
  })

  window.addEventListener('beforeunload', () => {
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer)
  })
}

void initialize()
