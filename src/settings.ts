import { invoke } from '@tauri-apps/api/core'
import { mountImportConfirmation } from './import-confirmation'
import { mountSchedulePreview, type PreviewCourse } from './schedule-preview'
import './settings.css'
import './settings-alignment.css'
import './settings-window-fixes.css'

type ExcelImportPreview = {
  fileName: string
  detectedTermText: string | null
  arrangements: number
  highestWeek: number
  locationCount: number
  warnings: string[]
  courses: PreviewCourse[]
}

type SectionTime = {
  section: number
  start: string
  end: string
}

type ApplyImportedScheduleResult = {
  courseCount: number
  missingLocationCount: number
  warnings: string[]
}

const isDesktopRuntime = '__TAURI_INTERNALS__' in window
const runtimeNote = isDesktopRuntime
  ? 'Excel 课表会直接在本机解析，不会上传。应用新课表前会自动备份旧课表。'
  : '当前是浏览器界面预览版，不会修改正式课表。桌面应用中会在本机解析所选文件。'
const runtimeBadge = isDesktopRuntime ? '桌面窗口' : '界面预览'
const importHint = isDesktopRuntime
  ? '选择后会立即在本机解析并显示真实摘要，不会上传文件。'
  : '当前仅做界面预览，桌面应用中会调用本机 Excel 解析器。'

const defaultLessonTimes = [
  { lesson: 1, start: '08:00', end: '08:45' },
  { lesson: 2, start: '08:55', end: '09:40' },
  { lesson: 3, start: '10:00', end: '10:45' },
  { lesson: 4, start: '10:55', end: '11:40' },
  { lesson: 5, start: '13:30', end: '14:15' },
  { lesson: 6, start: '14:25', end: '15:10' },
  { lesson: 7, start: '15:30', end: '16:15' },
  { lesson: 8, start: '16:25', end: '17:10' },
  { lesson: 9, start: '18:00', end: '18:45' },
  { lesson: 10, start: '18:55', end: '19:40' },
]

const timeGroups = [
  { label: '上午', lessons: defaultLessonTimes.slice(0, 4) },
  { label: '下午', lessons: defaultLessonTimes.slice(4, 8) },
  { label: '晚上', lessons: defaultLessonTimes.slice(8) },
]

const timeEditorMarkup = timeGroups
  .map(
    (group) => `
      <section class="time-group" aria-label="${group.label}作息">
        <div class="time-group__title">${group.label}</div>
        <div class="time-editor__header" aria-hidden="true">
          <span>节次</span><span>开始</span><span>结束</span>
        </div>
        ${group.lessons
          .map(
            (item) => `
              <div class="time-editor__row" data-time-row="${item.lesson}">
                <strong>第 ${item.lesson} 节</strong>
                <input class="time-input" type="time" data-time-role="start" data-lesson="${item.lesson}" value="${item.start}" aria-label="第 ${item.lesson} 节开始时间" />
                <input class="time-input" type="time" data-time-role="end" data-lesson="${item.lesson}" value="${item.end}" aria-label="第 ${item.lesson} 节结束时间" />
              </div>
            `,
          )
          .join('')}
      </section>
    `,
  )
  .join('')

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('找不到设置页面根节点 #app')
}

app.innerHTML = `
  <main class="settings-shell">
    <aside class="settings-sidebar" aria-label="设置导航">
      <div class="app-mark">
        <div class="app-mark__icon" aria-hidden="true">课</div>
        <div>
          <p class="app-mark__title">桌面课表</p>
          <p class="app-mark__caption">课表与设置</p>
        </div>
      </div>

      <nav class="settings-nav" role="tablist" aria-label="设置页面">
        <button class="settings-nav__button" type="button" role="tab" aria-selected="true" data-panel-target="schedule">课表</button>
        <button class="settings-nav__button" type="button" role="tab" aria-selected="false" data-panel-target="times">作息时间</button>
        <button class="settings-nav__button" type="button" role="tab" aria-selected="false" data-panel-target="help">使用帮助</button>
      </nav>

      <p class="sidebar-note">${runtimeNote}</p>
    </aside>

    <section class="settings-content">
      <header class="page-header">
        <div>
          <h1 id="page-title">课表</h1>
          <p id="page-description">导入学校导出的 Excel 课表，并确认学期信息。</p>
        </div>
        <span class="status-badge">${runtimeBadge}</span>
      </header>

      <section class="settings-panel is-active" data-panel="schedule" aria-labelledby="page-title">
        <div class="card-grid" id="schedule-card-grid">
          <article class="card card--wide">
            <p class="card__eyebrow">推荐方式</p>
            <h2>导入 Excel 课表</h2>
            <p>在学校教务系统中导出课表文件，然后选择 .xlsx 文件。姓名、学号和教师信息不会保留。</p>

            <div class="import-zone">
              <strong id="file-name">选择一份 .xlsx 课表</strong>
              <p>${importHint}</p>
              <input class="file-input" id="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
              <div class="button-row button-row--centered">
                <button class="button button--primary" id="select-excel" type="button">选择 Excel 文件</button>
                <button class="button button--secondary" id="json-import" type="button">高级：导入 JSON</button>
              </div>
            </div>
            <p class="inline-message" id="import-message" role="status"></p>
          </article>

          <article class="card">
            <p class="card__eyebrow">学期信息</p>
            <h2>确认第一教学周</h2>
            <p>Excel 通常只能识别学期名称，第一周星期一需要由你确认。</p>
            <div class="field-grid">
              <div class="field">
                <label for="semester-name">学期名称</label>
                <input id="semester-name" value="2026-2027 学年第一学期" />
              </div>
              <div class="field">
                <label for="first-week">第一周星期一</label>
                <input id="first-week" type="date" value="2026-09-07" />
              </div>
            </div>
          </article>

          <article class="card">
            <p class="card__eyebrow">识别结果</p>
            <h2>课表摘要</h2>
            <div class="summary-list">
              <div class="summary-item"><span>已识别安排</span><strong id="summary-arrangements">—</strong></div>
              <div class="summary-item"><span>最高教学周</span><strong id="summary-highest-week">—</strong></div>
              <div class="summary-item"><span>地点信息</span><strong id="summary-locations">—</strong></div>
            </div>
          </article>

          <article class="card card--wide">
            <p class="card__eyebrow">快速导入</p>
            <h2>直接应用，按需检查</h2>
            <p>解析成功后可以直接应用。地点缺失不会阻止导入；需要时再打开预览或手动补充。</p>
            <div class="button-row">
              <button class="button button--primary" id="apply-schedule" type="button" disabled>直接应用课表</button>
              <button class="button button--secondary" id="preview-schedule" type="button" disabled>查看课表预览</button>
              <button class="button button--secondary" id="review-arrangements" type="button" disabled>检查课程安排</button>
              <button class="button button--secondary" id="open-location" type="button">打开课表位置</button>
            </div>
            <p class="inline-message" id="schedule-message" role="status"></p>
          </article>
        </div>
      </section>

      <section class="settings-panel" data-panel="times" aria-labelledby="page-title">
        <article class="card card--wide">
          <div class="time-panel-heading">
            <div>
              <p class="card__eyebrow">默认作息</p>
              <h2>逐节设置上课时间</h2>
              <p>上午、下午和晚上只用于分组显示，不会把两节课绑定在一起。每一节都能单独调整开始和结束时间。</p>
            </div>
            <label class="check-option" for="equal-duration">
              <input id="equal-duration" type="checkbox" />
              <span>每节课时长相同</span>
            </label>
          </div>

          <div class="time-editor">${timeEditorMarkup}</div>

          <div class="button-row">
            <button class="button button--primary" id="save-times" type="button">保存作息时间</button>
            <button class="button button--secondary" id="restore-times" type="button">恢复默认</button>
          </div>
          <p class="inline-message" id="times-message" role="status"></p>
        </article>
      </section>

      <section class="settings-panel" data-panel="help" aria-labelledby="page-title">
        <div class="help-stack">
          <article class="help-item">
            <h2>如何导出课表</h2>
            <p>打开学校常用的教务系统课表页面，寻找“导出”“下载”或“Excel”等入口，优先保存为 .xlsx 文件。</p>
          </article>
          <article class="help-item">
            <h2>关闭后课表去哪了</h2>
            <p>关闭桌面组件只会隐藏到系统托盘。点击托盘图标可重新显示，只有“退出程序”才会结束进程。</p>
          </article>
          <article class="help-item">
            <h2>优先向 AI 求助</h2>
            <p>遇到导入失败、课程缺失或显示异常时，建议先把报错文字和经过隐私处理的截图发给 AI。上传前遮住姓名、学号和教师信息，不要提供教务账号、密码、Cookie 或验证码。</p>
            <div class="button-row">
              <button class="button button--secondary" id="copy-help" type="button">复制 AI 求助模板</button>
            </div>
            <p class="inline-message" id="help-message" role="status"></p>
          </article>
        </div>
      </section>
    </section>
  </main>
`

const pageCopy: Record<string, { title: string; description: string }> = {
  schedule: {
    title: '课表',
    description: '导入学校导出的 Excel 课表，并确认学期信息。',
  },
  times: {
    title: '作息时间',
    description: '逐节检查和调整每一节课的开始、结束时间。',
  },
  help: {
    title: '使用帮助',
    description: '了解导入、托盘行为和安全求助方式。',
  },
}

const title = document.querySelector<HTMLHeadingElement>('#page-title')
const description = document.querySelector<HTMLParagraphElement>('#page-description')
const tabs = document.querySelectorAll<HTMLButtonElement>('[data-panel-target]')
const panels = document.querySelectorAll<HTMLElement>('[data-panel]')
const excelFile = document.querySelector<HTMLInputElement>('#excel-file')
const selectExcelButton = document.querySelector<HTMLButtonElement>('#select-excel')
const applyScheduleButton = document.querySelector<HTMLButtonElement>('#apply-schedule')
const previewScheduleButton = document.querySelector<HTMLButtonElement>('#preview-schedule')
const reviewArrangementsButton = document.querySelector<HTMLButtonElement>('#review-arrangements')
const fileName = document.querySelector<HTMLElement>('#file-name')
const semesterName = document.querySelector<HTMLInputElement>('#semester-name')
const firstWeek = document.querySelector<HTMLInputElement>('#first-week')
const summaryArrangements = document.querySelector<HTMLElement>('#summary-arrangements')
const summaryHighestWeek = document.querySelector<HTMLElement>('#summary-highest-week')
const summaryLocations = document.querySelector<HTMLElement>('#summary-locations')
const scheduleCardGrid = document.querySelector<HTMLElement>('#schedule-card-grid')
let currentExcelPreview: ExcelImportPreview | null = null

const schedulePreview = mountSchedulePreview()
const importConfirmation = scheduleCardGrid
  ? mountImportConfirmation(scheduleCardGrid, ({ courses, locationCount, missingCount }) => {
      if (!currentExcelPreview) return
      currentExcelPreview = {
        ...currentExcelPreview,
        courses,
        locationCount,
      }
      schedulePreview.setData(courses, currentExcelPreview.highestWeek)
      if (summaryLocations) summaryLocations.textContent = `${locationCount} 项有效`
      if (reviewArrangementsButton) {
        reviewArrangementsButton.textContent = missingCount > 0 ? `补充缺失地点（${missingCount}）` : '检查课程安排'
      }
    })
  : null

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.panelTarget
    if (!target || !pageCopy[target]) return

    for (const item of tabs) {
      item.setAttribute('aria-selected', String(item === tab))
    }

    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.panel === target)
    }

    if (title) title.textContent = pageCopy[target].title
    if (description) description.textContent = pageCopy[target].description
    document.querySelector('.settings-content')?.scrollTo({ top: 0 })
  })
}

function showMessage(selector: string, message: string): void {
  const target = document.querySelector<HTMLElement>(selector)
  if (target) target.textContent = message
}

function missingLocationCount(preview: ExcelImportPreview): number {
  return preview.courses.filter((course) => !course.location?.trim()).length
}

function resetImportSummary(): void {
  currentExcelPreview = null
  schedulePreview.clear()
  importConfirmation?.clear()
  if (applyScheduleButton) applyScheduleButton.disabled = true
  if (previewScheduleButton) previewScheduleButton.disabled = true
  if (reviewArrangementsButton) {
    reviewArrangementsButton.disabled = true
    reviewArrangementsButton.textContent = '检查课程安排'
  }
  if (summaryArrangements) summaryArrangements.textContent = '—'
  if (summaryHighestWeek) summaryHighestWeek.textContent = '—'
  if (summaryLocations) summaryLocations.textContent = '—'
  showMessage('#schedule-message', '')
}

function applyImportPreview(preview: ExcelImportPreview): void {
  currentExcelPreview = preview
  schedulePreview.setData(preview.courses, preview.highestWeek)
  importConfirmation?.setCourses(preview.courses)
  if (applyScheduleButton) applyScheduleButton.disabled = false
  if (previewScheduleButton) previewScheduleButton.disabled = false
  if (reviewArrangementsButton) reviewArrangementsButton.disabled = false
  if (fileName) fileName.textContent = preview.fileName
  if (summaryArrangements) summaryArrangements.textContent = `${preview.arrangements} 项`
  if (summaryHighestWeek) summaryHighestWeek.textContent = `${preview.highestWeek} 周`
  if (summaryLocations) summaryLocations.textContent = `${preview.locationCount} 项有效`
  if (semesterName && preview.detectedTermText) semesterName.value = preview.detectedTermText

  const missingCount = missingLocationCount(preview)
  if (reviewArrangementsButton) {
    reviewArrangementsButton.textContent = missingCount > 0 ? `补充缺失地点（${missingCount}）` : '检查课程安排'
  }
  const warningSuffix = preview.warnings.length > 0 ? `，另有 ${preview.warnings.length} 条解析提示` : ''
  showMessage('#import-message', `解析完成：识别 ${preview.arrangements} 项课程安排${warningSuffix}。`)
  showMessage(
    '#schedule-message',
    missingCount > 0
      ? `发现 ${missingCount} 项地点未填写，不影响使用。可以直接应用，也可以先补充。`
      : '课表信息完整，可以直接应用。',
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return '未知错误'
  }
}

async function chooseDesktopExcel(): Promise<void> {
  if (!selectExcelButton) return

  selectExcelButton.disabled = true
  selectExcelButton.textContent = '等待选择或解析…'
  resetImportSummary()
  showMessage('#import-message', '请选择 .xlsx 课表；选定后会立即在本机解析。')

  try {
    const preview = await invoke<ExcelImportPreview | null>('choose_and_parse_excel')
    if (!preview) {
      showMessage('#import-message', '已取消选择，没有修改任何课表数据。')
      return
    }
    applyImportPreview(preview)
  } catch (error) {
    showMessage('#import-message', `解析失败：${errorMessage(error)}`)
  } finally {
    selectExcelButton.disabled = false
    selectExcelButton.textContent = '选择 Excel 文件'
  }
}

selectExcelButton?.addEventListener('click', () => {
  if (isDesktopRuntime) {
    void chooseDesktopExcel()
  } else {
    excelFile?.click()
  }
})

excelFile?.addEventListener('change', () => {
  const file = excelFile.files?.[0]
  if (!file) return

  resetImportSummary()
  if (fileName) fileName.textContent = file.name
  showMessage('#import-message', '浏览器预览无法解析本机文件，请在桌面应用中测试。')
})

function timeToMinutes(value: string): number | null {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function minutesToTime(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59))
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function commonDuration(): number | null {
  const firstStart = document.querySelector<HTMLInputElement>('[data-time-role="start"][data-lesson="1"]')
  const firstEnd = document.querySelector<HTMLInputElement>('[data-time-role="end"][data-lesson="1"]')
  if (!firstStart || !firstEnd) return null

  const start = timeToMinutes(firstStart.value)
  const end = timeToMinutes(firstEnd.value)
  if (start === null || end === null || end <= start) return null
  return end - start
}

function applyCommonDuration(): void {
  const duration = commonDuration()
  if (duration === null) {
    showMessage('#times-message', '请先填写有效的第 1 节开始和结束时间。')
    return
  }

  for (const startInput of document.querySelectorAll<HTMLInputElement>('[data-time-role="start"]')) {
    const lesson = startInput.dataset.lesson
    const endInput = document.querySelector<HTMLInputElement>(`[data-time-role="end"][data-lesson="${lesson}"]`)
    const start = timeToMinutes(startInput.value)
    if (endInput && start !== null) endInput.value = minutesToTime(start + duration)
  }
}

function collectLessonTimes(): SectionTime[] {
  return defaultLessonTimes.map((item) => {
    const startInput = document.querySelector<HTMLInputElement>(`[data-time-role="start"][data-lesson="${item.lesson}"]`)
    const endInput = document.querySelector<HTMLInputElement>(`[data-time-role="end"][data-lesson="${item.lesson}"]`)
    const start = startInput?.value ?? ''
    const end = endInput?.value ?? ''
    const startMinutes = timeToMinutes(start)
    const endMinutes = timeToMinutes(end)
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      throw new Error(`第 ${item.lesson} 节的作息时间无效`)
    }
    return { section: item.lesson, start, end }
  })
}

const equalDuration = document.querySelector<HTMLInputElement>('#equal-duration')

equalDuration?.addEventListener('change', () => {
  if (equalDuration.checked) {
    applyCommonDuration()
    showMessage('#times-message', '已统一每节课时长；仍可分别调整每一节的开始时间。')
  } else {
    showMessage('#times-message', '已关闭统一时长，每一节的开始和结束时间都可以独立调整。')
  }
})

for (const input of document.querySelectorAll<HTMLInputElement>('.time-input')) {
  input.addEventListener('change', () => {
    if (!equalDuration?.checked) return

    if (input.dataset.timeRole === 'end' && input.dataset.lesson !== '1') {
      applyCommonDuration()
      return
    }

    applyCommonDuration()
  })
}

document.querySelector('#json-import')?.addEventListener('click', () => {
  showMessage('#import-message', 'JSON 导入将作为高级兼容入口保留在设置页中。')
})

applyScheduleButton?.addEventListener('click', () => {
  void (async () => {
    if (!currentExcelPreview) {
      showMessage('#schedule-message', '请先选择并成功解析一份 Excel 课表。')
      return
    }
    if (!isDesktopRuntime) {
      showMessage('#schedule-message', '浏览器预览不会写入正式课表，请在桌面应用中测试。')
      return
    }
    if (!firstWeek?.value) {
      showMessage('#schedule-message', '请先确认第一周星期一。')
      return
    }

    applyScheduleButton.disabled = true
    applyScheduleButton.textContent = '正在应用…'
    try {
      const result = await invoke<ApplyImportedScheduleResult>('apply_imported_schedule', {
        request: {
          firstWeekMonday: firstWeek.value,
          courses: currentExcelPreview.courses,
          times: collectLessonTimes(),
        },
      })
      const missingCopy = result.missingLocationCount > 0 ? `，其中 ${result.missingLocationCount} 项地点留空` : ''
      const warningCopy = result.warnings.length > 0 ? `，另有 ${result.warnings.length} 条时间冲突提示` : ''
      showMessage(
        '#schedule-message',
        `应用成功：${result.courseCount} 项安排已写入，旧课表已备份，桌面组件已刷新${missingCopy}${warningCopy}。`,
      )
    } catch (error) {
      showMessage('#schedule-message', `应用失败：${errorMessage(error)}`)
    } finally {
      applyScheduleButton.disabled = false
      applyScheduleButton.textContent = '直接应用课表'
    }
  })()
})

previewScheduleButton?.addEventListener('click', () => {
  if (!currentExcelPreview || !schedulePreview.open()) {
    showMessage('#schedule-message', '请先选择并成功解析一份 Excel 课表。')
  }
})

reviewArrangementsButton?.addEventListener('click', () => {
  if (!currentExcelPreview) {
    showMessage('#schedule-message', '请先选择并成功解析一份 Excel 课表。')
    return
  }
  importConfirmation?.focus()
})

document.querySelector('#open-location')?.addEventListener('click', () => {
  showMessage(
    '#schedule-message',
    isDesktopRuntime
      ? '当前可使用托盘菜单“打开课表位置”。设置页按钮将在后续直接连接。'
      : '浏览器预览无法打开本机目录，桌面应用中会接入该功能。',
  )
})

document.querySelector('#save-times')?.addEventListener('click', () => {
  showMessage('#times-message', '当前作息会在应用课表时使用；独立保存将在后续接入。')
})

document.querySelector('#restore-times')?.addEventListener('click', () => {
  for (const item of defaultLessonTimes) {
    const startInput = document.querySelector<HTMLInputElement>(`[data-time-role="start"][data-lesson="${item.lesson}"]`)
    const endInput = document.querySelector<HTMLInputElement>(`[data-time-role="end"][data-lesson="${item.lesson}"]`)
    if (startInput) startInput.value = item.start
    if (endInput) endInput.value = item.end
  }
  if (equalDuration) equalDuration.checked = false
  showMessage('#times-message', '已恢复默认的逐节作息时间。')
})

const helpText = [
  '我正在使用桌面课表组件，遇到了课表导入或显示问题。',
  '请根据我提供的报错文字和界面截图，判断最可能的原因，并一次只给我一个排查步骤。',
  '我已经遮住姓名、学号和教师信息，也不会提供教务账号、密码、Cookie 或验证码。',
  '问题现象：',
].join('\n')

document.querySelector('#copy-help')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(helpText)
    showMessage('#help-message', 'AI 求助模板已复制。')
  } catch {
    showMessage('#help-message', '当前环境未允许复制，请手动选择说明文字。')
  }
})
