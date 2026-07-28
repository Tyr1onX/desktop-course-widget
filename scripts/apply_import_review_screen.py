from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, content: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    target.write_text(text.rstrip() + "\n\n" + content.rstrip() + "\n", encoding="utf-8")


replace_once(
    "src/settings.ts",
    "import type { ImportDraft } from './import-draft'\nimport scheduleData from './data/schedule.json'",
    "import type { ImportCourse, ImportDraft } from './import-draft'\nimport { parseWeeksText, refreshImportDraftSummary, validateImportCourse, validateImportDraft, weeksToText } from './import-review'\nimport scheduleData from './data/schedule.json'",
)

replace_once(
    "src/settings.ts",
    "let importDraft: ImportDraft | null = null\nlet surfaceMessage = ''",
    "let importDraft: ImportDraft | null = null\nlet importNameDraft = ''\nlet importFirstWeekDraft = ''\nlet expandedImportCourseIndex = 0\nlet surfaceMessage = ''",
)

old_surface = '''function importSurfaceMarkup(): string {
  const draft = importDraft
  return surfaceShell('导入新课表', `
    <div class="surface-scroll simple-surface">
      <div class="surface-intro">
        <h3>从 Excel 创建独立课表</h3>
        <p>每次导入都会新建一份课表并自动切换过去，已有课表不会被覆盖。</p>
      </div>
      <button class="import-picker" type="button" data-action="choose-excel">
        <strong>${escapeHtml(draft?.sourceName ?? '选择一份 .xlsx 课表')}</strong>
        <span>${desktopRuntime ? '文件只在本机解析，不会上传' : '浏览器预览中不会读取本机文件'}</span>
      </button>
      ${draft ? `
        <div class="import-summary">
          <div><span>课程安排</span><strong>${draft.summary.arrangements} 项</strong></div>
          <div><span>最高教学周</span><strong>${draft.summary.highestWeek} 周</strong></div>
          <div><span>有效地点</span><strong>${draft.summary.locationCount} 项</strong></div>
        </div>
        <label class="field field--full"><span>课表名称</span><input id="import-name" value="${escapeHtml(draft.suggestedName)}" /></label>
        <label class="field field--full"><span>第一周星期一</span><input id="import-first-week" type="date" value="${schedule.semesterStart}" /></label>
        ${draft.warnings.length ? `<p class="warning-note">解析器给出了 ${draft.warnings.length} 条提示，创建后可继续检查课程。</p>` : ''}
      ` : ''}
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions surface-actions--end">
      <button class="primary-button" type="button" data-action="create-imported-schedule"${draft ? '' : ' disabled'}>创建并启用课表</button>
    </footer>
  `)
}
'''

new_surface = '''function importCourseReviewMarkup(course: ImportCourse, index: number): string {
  const issues = validateImportCourse(course, settings.lessonTimes.length)
  const weekday = weekdayLabels[course.weekday - 1] ?? '星期待确认'
  const sectionText = course.startSection === course.endSection
    ? `第 ${course.startSection} 节`
    : `第 ${course.startSection}–${course.endSection} 节`
  const weekText = weeksToText(course.weeks)
  const lessonOptions = settings.lessonTimes.map((item) => `<option value="${item.section}">${item.section}</option>`).join('')
  const startOptions = lessonOptions.replace(`value="${course.startSection}"`, `value="${course.startSection}" selected`)
  const endOptions = lessonOptions.replace(`value="${course.endSection}"`, `value="${course.endSection}" selected`)
  return `
    <details class="import-course-review${issues.length ? ' has-issues' : ''}" data-import-course-details="${index}"${expandedImportCourseIndex === index ? ' open' : ''}>
      <summary>
        <span class="import-course-copy">
          <strong>${escapeHtml(course.name.trim() || `未命名课程 ${index + 1}`)}</strong>
          <small>${escapeHtml(`${weekday} · ${sectionText} · ${weekText || '周次待确认'}周`)}</small>
        </span>
        <span class="import-course-state">${issues.length ? `${issues.length} 项待确认` : '信息完整'}</span>
      </summary>
      <div class="import-course-review-grid">
        <label class="field field--full">
          <span>课程名称</span>
          <input value="${escapeHtml(course.name)}" maxlength="160" data-import-course="${index}" data-import-field="name" />
        </label>
        <label class="field">
          <span>星期</span>
          <select data-import-course="${index}" data-import-field="weekday">
            ${weekdayLabels.map((label, offset) => `<option value="${offset + 1}"${course.weekday === offset + 1 ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>重复</span>
          <select data-import-course="${index}" data-import-field="parity">
            <option value="all"${course.parity === 'all' ? ' selected' : ''}>每周</option>
            <option value="odd"${course.parity === 'odd' ? ' selected' : ''}>单周</option>
            <option value="even"${course.parity === 'even' ? ' selected' : ''}>双周</option>
          </select>
        </label>
        <label class="field">
          <span>开始节次</span>
          <select data-import-course="${index}" data-import-field="startSection">${startOptions}</select>
        </label>
        <label class="field">
          <span>结束节次</span>
          <select data-import-course="${index}" data-import-field="endSection">${endOptions}</select>
        </label>
        <label class="field field--full">
          <span>教学周</span>
          <input value="${escapeHtml(weekText)}" placeholder="例如 1-8, 10-16" data-import-course="${index}" data-import-field="weeks" />
        </label>
        <label class="field">
          <span>地点</span>
          <input value="${escapeHtml(course.location ?? '')}" maxlength="160" placeholder="选填" data-import-course="${index}" data-import-field="location" />
        </label>
        <label class="field">
          <span>老师</span>
          <input value="${escapeHtml(course.teacher ?? '')}" maxlength="160" placeholder="选填" data-import-course="${index}" data-import-field="teacher" />
        </label>
      </div>
      ${issues.length ? `<ul class="import-course-issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : ''}
    </details>
  `
}

function importSurfaceMarkup(): string {
  const draft = importDraft
  const issueCount = draft
    ? draft.courses.reduce((total, course) => total + validateImportCourse(course, settings.lessonTimes.length).length, 0)
    : 0
  const reviewCards = draft?.courses.map(importCourseReviewMarkup).join('') ?? ''
  return surfaceShell('检查并导入课表', `
    <div class="surface-scroll simple-surface import-review-surface">
      <div class="surface-intro">
        <h3>从 Excel 创建独立课表</h3>
        <p>先逐项检查识别结果，再创建新课表；已有课表不会被覆盖。</p>
      </div>
      <button class="import-picker" type="button" data-action="choose-excel">
        <strong>${escapeHtml(draft?.sourceName ?? '选择一份 .xlsx 课表')}</strong>
        <span>${desktopRuntime ? '文件只在本机解析，不会上传' : '浏览器预览中不会读取本机文件'}</span>
      </button>
      ${draft ? `
        <div class="import-summary">
          <div><span>课程安排</span><strong>${draft.summary.arrangements} 项</strong></div>
          <div><span>最高教学周</span><strong>${draft.summary.highestWeek} 周</strong></div>
          <div><span>待确认</span><strong>${issueCount} 项</strong></div>
        </div>
        <div class="import-basics">
          <label class="field field--full"><span>课表名称</span><input id="import-name" value="${escapeHtml(importNameDraft || draft.suggestedName)}" /></label>
          <label class="field field--full"><span>第一周星期一</span><input id="import-first-week" type="date" value="${escapeHtml(importFirstWeekDraft || schedule.semesterStart)}" /></label>
        </div>
        ${draft.warnings.length ? `
          <section class="import-parser-warnings">
            <strong>解析提示</strong>
            <ul>${draft.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
          </section>
        ` : ''}
        <div class="import-review-heading">
          <div><h3>逐项检查</h3><p>展开课程可修改星期、节次、周次、地点和老师。</p></div>
          <span>${draft.courses.length} 项</span>
        </div>
        <div class="import-review-list">${reviewCards}</div>
      ` : ''}
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions surface-actions--end">
      <button class="primary-button" type="button" data-action="create-imported-schedule"${draft && issueCount === 0 ? '' : ' disabled'}>确认并创建课表</button>
    </footer>
  `, true)
}
'''
replace_once("src/settings.ts", old_surface, new_surface)

old_bind = '''function bindImportEvents(): void {
  document.querySelector('[data-action="choose-excel"]')?.addEventListener('click', () => void chooseExcel())
  document.querySelector('[data-action="create-imported-schedule"]')?.addEventListener('click', () => void createImportedSchedule())
}
'''
new_bind = '''function bindImportEvents(): void {
  document.querySelector('[data-action="choose-excel"]')?.addEventListener('click', () => void chooseExcel())
  document.querySelector('[data-action="create-imported-schedule"]')?.addEventListener('click', () => void createImportedSchedule())
  document.querySelector<HTMLInputElement>('#import-name')?.addEventListener('input', (event) => {
    importNameDraft = (event.currentTarget as HTMLInputElement).value
  })
  document.querySelector<HTMLInputElement>('#import-first-week')?.addEventListener('input', (event) => {
    importFirstWeekDraft = (event.currentTarget as HTMLInputElement).value
  })
  for (const details of document.querySelectorAll<HTMLDetailsElement>('[data-import-course-details]')) {
    details.addEventListener('toggle', () => {
      if (details.open) expandedImportCourseIndex = Number(details.dataset.importCourseDetails ?? 0)
    })
  }
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-import-field]')) {
    control.addEventListener('change', () => updateImportCourseField(control))
  }
}

function updateImportCourseField(control: HTMLInputElement | HTMLSelectElement): void {
  if (!importDraft) return
  const index = Number(control.dataset.importCourse)
  const field = control.dataset.importField
  const course = importDraft.courses[index]
  if (!course || !field) return
  expandedImportCourseIndex = index
  try {
    if (field === 'name') course.name = control.value
    if (field === 'weekday') course.weekday = Number(control.value)
    if (field === 'startSection') course.startSection = Number(control.value)
    if (field === 'endSection') course.endSection = Number(control.value)
    if (field === 'weeks') course.weeks = parseWeeksText(control.value)
    if (field === 'parity') course.parity = control.value as ImportCourse['parity']
    if (field === 'location') course.location = control.value
    if (field === 'teacher') course.teacher = control.value
    refreshImportDraftSummary(importDraft)
    surfaceMessage = ''
  } catch (error) {
    surfaceMessage = errorText(error)
  }
  render()
}
'''
replace_once("src/settings.ts", old_bind, new_bind)

replace_once(
    "src/settings.ts",
    """    importDraft = await invoke<ImportDraft | null>('choose_and_parse_excel')
    surfaceMessage = importDraft ? '解析完成，请确认课表名称和第一周日期。' : '已取消选择。'""",
    """    importDraft = await invoke<ImportDraft | null>('choose_and_parse_excel')
    if (importDraft) {
      importNameDraft = importDraft.suggestedName
      importFirstWeekDraft = schedule.semesterStart
      expandedImportCourseIndex = 0
      refreshImportDraftSummary(importDraft)
    } else {
      importNameDraft = ''
      importFirstWeekDraft = ''
    }
    surfaceMessage = importDraft ? '解析完成，请逐项检查课程信息。' : '已取消选择。'""",
)

replace_once(
    "src/settings.ts",
    """  const name = document.querySelector<HTMLInputElement>('#import-name')?.value.trim() ?? ''
  const firstWeekMonday = document.querySelector<HTMLInputElement>('#import-first-week')?.value ?? ''
  try {
    if (!name) throw new Error('请填写课表名称')
    if (!firstWeekMonday) throw new Error('请确认第一周星期一')""",
    """  const name = importNameDraft.trim()
  const firstWeekMonday = importFirstWeekDraft
  try {
    if (!name) throw new Error('请填写课表名称')
    if (!firstWeekMonday) throw new Error('请确认第一周星期一')
    const issues = validateImportDraft(importDraft, settings.lessonTimes.length)
    if (issues.length) throw new Error(issues.slice(0, 3).join('；'))
    refreshImportDraftSummary(importDraft)""",
)

replace_once(
    "src/settings.ts",
    """    importDraft = null
    surface = null""",
    """    importDraft = null
    importNameDraft = ''
    importFirstWeekDraft = ''
    expandedImportCourseIndex = 0
    surface = null""",
)

append_once(
    "src/settings.css",
    "/* Import draft review */",
    '''/* Import draft review */
.import-review-surface { display: flex; flex-direction: column; gap: 0; }
.import-basics { display: grid; gap: 12px; margin-top: 14px; }
.import-parser-warnings { margin-top: 14px; padding: 12px 13px; border-radius: 10px; background: #fff7e6; color: #76551d; }
.import-parser-warnings > strong { font-size: 12px; }
.import-parser-warnings ul,
.import-course-issues { margin: 7px 0 0; padding-left: 18px; font-size: 11px; line-height: 1.55; }
.import-review-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 20px 0 9px; }
.import-review-heading h3 { margin: 0; font-size: 14px; }
.import-review-heading p { margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.import-review-heading > span { flex: 0 0 auto; color: var(--muted); font-size: 11px; }
.import-review-list { display: grid; gap: 8px; width: 100%; min-width: 0; }
.import-course-review { min-width: 0; overflow: hidden; border: 1px solid #e0e3e8; border-radius: 11px; background: #fff; }
.import-course-review.has-issues { border-color: #e4bd8a; background: #fffdf8; }
.import-course-review > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 12px 13px; list-style: none; cursor: pointer; }
.import-course-review > summary::-webkit-details-marker { display: none; }
.import-course-review > summary::after { flex: 0 0 auto; width: 14px; height: 14px; content: ''; background: currentColor; opacity: .55; -webkit-mask: var(--fluent-mask-chevron-down) center / contain no-repeat; mask: var(--fluent-mask-chevron-down) center / contain no-repeat; transition: transform 120ms ease; }
.import-course-review[open] > summary::after { transform: rotate(180deg); }
.import-course-copy { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
.import-course-copy strong,
.import-course-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.import-course-copy strong { font-size: 12px; font-weight: 650; }
.import-course-copy small { margin-top: 4px; color: var(--muted); font-size: 10px; }
.import-course-state { flex: 0 0 auto; padding: 3px 7px; border-radius: 999px; background: #eef3f8; color: #5f6874; font-size: 9px; }
.has-issues .import-course-state { background: #fff0d8; color: #8a5c1d; }
.import-course-review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 11px 10px; padding: 2px 13px 13px; border-top: 1px solid rgba(31, 35, 40, .07); }
.import-course-review-grid .field { min-width: 0; margin-top: 10px; }
.import-course-review-grid input,
.import-course-review-grid select { width: 100%; min-width: 0; }
.import-course-issues { margin: -2px 13px 13px; padding: 9px 10px 9px 26px; border-radius: 8px; background: #fff3e2; color: #855917; }
''',
)

replace_once(
    "CHANGELOG.md",
    "- Added a source-neutral import draft shared by Excel import and future screenshot recognition.\n",
    "- Added a source-neutral import draft shared by Excel import and future screenshot recognition.\n- Added a course-by-course review and correction screen before importing a timetable.\n",
)
