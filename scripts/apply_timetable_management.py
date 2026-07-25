from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[1]

# Rust schedule catalog API
rust_path = root / "src-tauri" / "src" / "schedule_catalog.rs"
rust = rust_path.read_text(encoding="utf-8")

rust = replace_once(
    rust,
    """pub struct SaveCourseSlot {
    weekday: u8,
    start: String,
    end: String,
    weeks: Vec<u8>,
    parity: String,
    location: String,
    teacher: String,
}
""",
    """pub struct SaveCourseSlot {
    weekday: u8,
    start: String,
    end: String,
    weeks: Vec<u8>,
    parity: String,
    location: String,
    teacher: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduleRequest {
    schedule_id: String,
    name: String,
    semester_start: String,
    semester_end: Option<String>,
}
""",
    "add update request",
)

rust = replace_once(
    rust,
    """            list_schedules,
            get_active_schedule,
            activate_schedule,
            delete_schedule,
""",
    """            list_schedules,
            get_active_schedule,
            get_schedule,
            update_schedule,
            activate_schedule,
            delete_schedule,
""",
    "register schedule commands",
)

rust = replace_once(
    rust,
    """#[tauri::command]
fn get_active_schedule(app: AppHandle) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    read_catalog_schedule(&app, &index.active_schedule_id)
}

#[tauri::command]
fn activate_schedule(app: AppHandle, schedule_id: String) -> Result<CatalogSchedule, String> {
""",
    """#[tauri::command]
fn get_active_schedule(app: AppHandle) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    read_catalog_schedule(&app, &index.active_schedule_id)
}

#[tauri::command]
fn get_schedule(app: AppHandle, schedule_id: String) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    if !index.schedule_ids.iter().any(|id| id == &schedule_id) {
        return Err("找不到要编辑的课表".into());
    }
    read_catalog_schedule(&app, &schedule_id)
}

#[tauri::command]
fn update_schedule(
    app: AppHandle,
    request: UpdateScheduleRequest,
) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    if !index
        .schedule_ids
        .iter()
        .any(|id| id == &request.schedule_id)
    {
        return Err("找不到要编辑的课表".into());
    }
    if request.name.trim().is_empty() {
        return Err("课表名称不能为空".into());
    }

    let mut schedule = read_catalog_schedule(&app, &request.schedule_id)?;
    schedule.name = request.name;
    schedule.semester_start = request.semester_start;
    schedule.semester_end = request.semester_end;
    schedule.updated_at = now_millis()?;
    normalize_catalog_schedule(&mut schedule)?;
    write_catalog_schedule(&app, &schedule)?;

    if index.active_schedule_id == schedule.id {
        apply_active_schedule(&app, &schedule)?;
        emit_schedule_updated(&app)?;
    }
    Ok(schedule)
}

#[tauri::command]
fn activate_schedule(app: AppHandle, schedule_id: String) -> Result<CatalogSchedule, String> {
""",
    "add schedule commands",
)

rust_path.write_text(rust, encoding="utf-8", newline="\n")

# Settings UI
settings_path = root / "src" / "settings.ts"
ts = settings_path.read_text(encoding="utf-8")

ts = replace_once(
    ts,
    "type Surface = 'course' | 'import' | 'times' | 'data' | 'help' | 'about' | null",
    "type Surface = 'course' | 'schedule' | 'import' | 'times' | 'data' | 'help' | 'about' | null",
    "extend surface type",
)

ts = replace_once(
    ts,
    """type CourseDraft = {
  courseId?: string
  name: string
  color: string
  slots: DraftSlot[]
}

""",
    """type CourseDraft = {
  courseId?: string
  name: string
  color: string
  slots: DraftSlot[]
}

type ScheduleDraft = {
  id: string
  name: string
  semesterStart: string
  totalWeeks: number
  courseCount: number
  active: boolean
}

""",
    "add schedule draft type",
)

ts = replace_once(
    ts,
    """let courseDraft: CourseDraft | null = null
let initialDraftSnapshot = ''
let importPreview: ExcelImportPreview | null = null
""",
    """let courseDraft: CourseDraft | null = null
let initialDraftSnapshot = ''
let scheduleDraft: ScheduleDraft | null = null
let initialScheduleDraftSnapshot = ''
let importPreview: ExcelImportPreview | null = null
""",
    "add schedule draft state",
)

ts = replace_once(
    ts,
    """function maximumWeek(value: CatalogSchedule): number {
  return Math.max(1, ...value.courses.flatMap((course) => course.weeks))
}
""",
    """function courseMaximumWeek(value: CatalogSchedule): number {
  return Math.max(1, ...value.courses.flatMap((course) => course.weeks))
}

function calendarWeekCount(semesterStart: string, semesterEnd?: string | null): number | null {
  if (!semesterEnd) return null
  const start = parseLocalDate(semesterStart)
  const end = parseLocalDate(semesterEnd)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (!Number.isFinite(days) || days <= 0) return null
  return clamp(Math.ceil(days / 7), 1, 30)
}

function maximumWeek(value: CatalogSchedule): number {
  return Math.max(courseMaximumWeek(value), calendarWeekCount(value.semesterStart, value.semesterEnd) ?? 1)
}
""",
    "add semester week helpers",
)

ts = replace_once(
    ts,
    """  if (surface === 'course') return courseSurfaceMarkup()
  if (surface === 'import') return importSurfaceMarkup()
""",
    """  if (surface === 'course') return courseSurfaceMarkup()
  if (surface === 'schedule') return scheduleSurfaceMarkup()
  if (surface === 'import') return importSurfaceMarkup()
""",
    "render schedule surface",
)

old_data_surface = """function dataSurfaceMarkup(): string {
  const items = summaries.map((item) => `
    <article class="schedule-record${item.active ? ' is-active' : ''}">
      <div>
        <div class="record-title"><strong>${escapeHtml(item.name)}</strong>${item.active ? '<span>当前</span>' : ''}</div>
        <p>${escapeHtml(item.semesterStart)} · ${item.courseCount} 门课程</p>
      </div>
      <div class="record-actions">
        ${item.active ? '' : `<button type="button" data-activate-schedule="${escapeHtml(item.id)}">启用</button>`}
        <button class="record-delete" type="button" data-delete-schedule="${escapeHtml(item.id)}"${summaries.length <= 1 ? ' disabled title="至少保留一份课表"' : ''}>删除</button>
      </div>
    </article>
  `).join('')
  return surfaceShell('课表与数据', `
    <div class="surface-scroll simple-surface">
      <div class="surface-intro"><h3>我的课表</h3><p>切换课表后，桌面组件会立即使用所选课表。</p></div>
      <div class="schedule-records">${items}</div>
      <div class="data-card">
        <h3>本地数据</h3>
        <p>课表、设置和自动备份都保存在应用本地目录。</p>
        <button class="secondary-button" type="button" data-action="open-data-location">打开数据位置</button>
      </div>
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
  `)
}
"""

new_data_surface = """function scheduleSurfaceMarkup(): string {
  if (!scheduleDraft) return ''
  const minimumWeeks = scheduleDraft.id === schedule.id ? courseMaximumWeek(schedule) : 1
  return surfaceShell('编辑课表', `
    <div class="surface-scroll simple-surface schedule-editor">
      <div class="surface-intro">
        <h3>课表信息</h3>
        <p>教学周会根据第一周星期一自动计算，修改后不会改变课程本身的周次。</p>
      </div>
      <div class="schedule-editor-form">
        <label class="field field--full">
          <span>课表名称</span>
          <input id="schedule-name" value="${escapeHtml(scheduleDraft.name)}" maxlength="80" placeholder="输入课表名称" />
        </label>
        <label class="field">
          <span>第一周星期一</span>
          <input id="schedule-semester-start" type="date" value="${escapeHtml(scheduleDraft.semesterStart)}" />
        </label>
        <label class="field">
          <span>学期总周数</span>
          <input id="schedule-total-weeks" type="number" min="${minimumWeeks}" max="30" value="${scheduleDraft.totalWeeks}" />
        </label>
      </div>
      <div class="schedule-metadata">
        <div><span>课程数量</span><strong>${scheduleDraft.courseCount} 门</strong></div>
        <div><span>当前状态</span><strong>${scheduleDraft.active ? '正在使用' : '未启用'}</strong></div>
      </div>
      ${minimumWeeks > 1 ? `<p class="editor-note">该课表的课程已使用到第 ${minimumWeeks} 周，因此总周数不能更少。</p>` : ''}
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
    <footer class="surface-actions">
      <button class="danger-button" type="button" data-action="delete-edited-schedule"${summaries.length <= 1 ? ' disabled title="至少保留一份课表"' : ''}>删除课表</button>
      <div class="action-group">
        <button class="secondary-button" type="button" data-action="cancel-schedule">取消</button>
        <button class="primary-button" type="button" data-action="save-schedule">保存修改</button>
      </div>
    </footer>
  `)
}

function dataSurfaceMarkup(): string {
  const items = summaries.map((item) => {
    const weeks = calendarWeekCount(item.semesterStart, item.semesterEnd)
    return `
      <article class="schedule-record${item.active ? ' is-active' : ''}">
        <div class="record-copy">
          <div class="record-title"><strong>${escapeHtml(item.name)}</strong>${item.active ? '<span>当前</span>' : ''}</div>
          <p>${escapeHtml(item.semesterStart)} · ${weeks ? `${weeks} 周 · ` : ''}${item.courseCount} 门课程</p>
        </div>
        <div class="record-actions">
          ${item.active ? '' : `<button type="button" data-activate-schedule="${escapeHtml(item.id)}">设为当前</button>`}
          <button type="button" data-edit-schedule="${escapeHtml(item.id)}">编辑</button>
          <button class="record-delete" type="button" data-delete-schedule="${escapeHtml(item.id)}"${summaries.length <= 1 ? ' disabled title="至少保留一份课表"' : ''}>删除</button>
        </div>
      </article>
    `
  }).join('')
  return surfaceShell('课表与数据', `
    <div class="surface-scroll simple-surface">
      <div class="surface-intro"><h3>我的课表</h3><p>可以切换、编辑或删除课表；桌面组件始终使用标记为“当前”的课表。</p></div>
      <div class="schedule-records">${items}</div>
      <div class="data-card">
        <h3>本地数据</h3>
        <p>课表、设置和自动备份都保存在应用本地目录。</p>
        <button class="secondary-button" type="button" data-action="open-data-location">打开数据位置</button>
      </div>
      <p class="surface-message" role="status">${escapeHtml(surfaceMessage)}</p>
    </div>
  `)
}
"""

ts = replace_once(ts, old_data_surface, new_data_surface, "replace data surface")

ts = replace_once(
    ts,
    """  bindCourseEvents()
  bindImportEvents()
  bindTimeEvents()
  bindDataEvents()
""",
    """  bindCourseEvents()
  bindScheduleEvents()
  bindImportEvents()
  bindTimeEvents()
  bindDataEvents()
""",
    "bind schedule events",
)

ts = replace_once(
    ts,
    """function closeSurface(reason: 'backdrop' | 'explicit'): void {
  if (surface === 'course' && draftDirty()) {
    if (reason === 'backdrop') return
    if (!window.confirm('放弃未保存的修改？')) return
  }
  surface = null
  selectedCourseId = null
  courseDraft = null
  initialDraftSnapshot = ''
  surfaceMessage = ''
  render()
}

function canLeaveCourse(action: string): boolean {
  if (surface !== 'course' || !draftDirty()) return true
  return window.confirm(`${action}会放弃当前未保存的修改，是否继续？`)
}

function draftDirty(): boolean {
  return Boolean(courseDraft && JSON.stringify(courseDraft) !== initialDraftSnapshot)
}
""",
    """function closeSurface(reason: 'backdrop' | 'explicit'): void {
  if (hasUnsavedChanges()) {
    if (reason === 'backdrop') return
    if (!window.confirm('放弃未保存的修改？')) return
  }
  surface = null
  selectedCourseId = null
  courseDraft = null
  initialDraftSnapshot = ''
  scheduleDraft = null
  initialScheduleDraftSnapshot = ''
  surfaceMessage = ''
  render()
}

function canLeaveCourse(action: string): boolean {
  if (!hasUnsavedChanges()) return true
  return window.confirm(`${action}会放弃当前未保存的修改，是否继续？`)
}

function hasUnsavedChanges(): boolean {
  return draftDirty() || scheduleDraftDirty()
}

function draftDirty(): boolean {
  return surface === 'course' && Boolean(courseDraft && JSON.stringify(courseDraft) !== initialDraftSnapshot)
}

function scheduleDraftDirty(): boolean {
  return surface === 'schedule' && Boolean(scheduleDraft && JSON.stringify(scheduleDraft) !== initialScheduleDraftSnapshot)
}
""",
    "generalize dirty checks",
)

schedule_functions = """
async function openScheduleEditor(id: string): Promise<void> {
  if (!id || !canLeaveCourse('编辑课表')) return
  try {
    let target: CatalogSchedule
    if (desktopRuntime) {
      target = await invoke<CatalogSchedule>(plugin('get_schedule'), { scheduleId: id })
    } else {
      target = schedule
    }
    const summary = summaries.find((item) => item.id === id) ?? summaryFromSchedule(target, id === schedule.id)
    scheduleDraft = {
      id: target.id,
      name: target.name,
      semesterStart: target.semesterStart,
      totalWeeks: maximumWeek(target),
      courseCount: summary.courseCount,
      active: summary.active,
    }
    initialScheduleDraftSnapshot = JSON.stringify(scheduleDraft)
    surface = 'schedule'
    selectedCourseId = null
    courseDraft = null
    initialDraftSnapshot = ''
    menuOpen = false
    scheduleMenuOpen = false
    surfaceMessage = ''
    render()
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

function bindScheduleEvents(): void {
  if (surface !== 'schedule' || !scheduleDraft) return
  document.querySelector<HTMLInputElement>('#schedule-name')?.addEventListener('input', (event) => {
    if (scheduleDraft) scheduleDraft.name = (event.currentTarget as HTMLInputElement).value
  })
  document.querySelector<HTMLInputElement>('#schedule-semester-start')?.addEventListener('input', (event) => {
    if (scheduleDraft) scheduleDraft.semesterStart = (event.currentTarget as HTMLInputElement).value
  })
  document.querySelector<HTMLInputElement>('#schedule-total-weeks')?.addEventListener('input', (event) => {
    if (scheduleDraft) scheduleDraft.totalWeeks = clamp(Number((event.currentTarget as HTMLInputElement).value), 1, 30)
  })
  document.querySelector('[data-action="cancel-schedule"]')?.addEventListener('click', () => closeSurface('explicit'))
  document.querySelector('[data-action="save-schedule"]')?.addEventListener('click', () => void saveSchedule())
  document.querySelector('[data-action="delete-edited-schedule"]')?.addEventListener('click', () => {
    if (scheduleDraft) void deleteSchedule(scheduleDraft.id)
  })
}

async function saveSchedule(): Promise<void> {
  if (!scheduleDraft) return
  try {
    const name = scheduleDraft.name.trim()
    if (!name) throw new Error('请填写课表名称')
    if (!scheduleDraft.semesterStart) throw new Error('请选择第一周星期一')
    const minimumWeeks = scheduleDraft.id === schedule.id ? courseMaximumWeek(schedule) : 1
    if (scheduleDraft.totalWeeks < minimumWeeks) throw new Error(`学期总周数不能少于 ${minimumWeeks} 周`)
    const semesterEnd = dateKey(addDays(parseLocalDate(scheduleDraft.semesterStart), scheduleDraft.totalWeeks * 7 - 1))

    if (desktopRuntime) {
      const updated = await invoke<CatalogSchedule>(plugin('update_schedule'), {
        request: {
          scheduleId: scheduleDraft.id,
          name,
          semesterStart: scheduleDraft.semesterStart,
          semesterEnd,
        },
      })
      if (updated.id === schedule.id) schedule = updated
      summaries = await invoke<ScheduleSummary[]>(plugin('list_schedules'))
    } else {
      schedule = { ...schedule, name, semesterStart: scheduleDraft.semesterStart, semesterEnd }
      summaries = [summaryFromSchedule(schedule, true)]
    }

    if (scheduleDraft.id === schedule.id) currentWeek = initialWeek(schedule)
    surface = 'data'
    scheduleDraft = null
    initialScheduleDraftSnapshot = ''
    surfaceMessage = ''
    render()
    showToast('课表信息已保存')
  } catch (error) {
    surfaceMessage = errorText(error)
    render()
  }
}

"""

ts = replace_once(ts, "function bindImportEvents(): void {\n", schedule_functions + "function bindImportEvents(): void {\n", "add schedule editor logic")

ts = replace_once(
    ts,
    """function bindDataEvents(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-activate-schedule]')) {
""",
    """function bindDataEvents(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-edit-schedule]')) {
    button.addEventListener('click', () => void openScheduleEditor(button.dataset.editSchedule ?? ''))
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-activate-schedule]')) {
""",
    "bind edit buttons",
)

ts = replace_once(
    ts,
    """    currentWeek = initialWeek(schedule)
    render()
    showToast('课表已删除')
""",
    """    currentWeek = initialWeek(schedule)
    surface = 'data'
    scheduleDraft = null
    initialScheduleDraftSnapshot = ''
    render()
    showToast('课表已删除')
""",
    "close editor after delete",
)

ts = replace_once(
    ts,
    """  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && surface === 'course') {
    event.preventDefault()
    void saveCourse()
  }
""",
    """  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && surface === 'course') {
    event.preventDefault()
    void saveCourse()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && surface === 'schedule') {
    event.preventDefault()
    void saveSchedule()
  }
""",
    "save schedule shortcut",
)

ts = replace_once(
    ts,
    """async function handleSettingsCloseRequest(): Promise<void> {
  if (surface === 'course' && draftDirty() && !window.confirm('放弃未保存的修改？')) return
  surface = null
  menuOpen = false
  scheduleMenuOpen = false
  selectedCourseId = null
  courseDraft = null
  initialDraftSnapshot = ''
  surfaceMessage = ''
""",
    """async function handleSettingsCloseRequest(): Promise<void> {
  if (hasUnsavedChanges() && !window.confirm('放弃未保存的修改？')) return
  surface = null
  menuOpen = false
  scheduleMenuOpen = false
  selectedCourseId = null
  courseDraft = null
  initialDraftSnapshot = ''
  scheduleDraft = null
  initialScheduleDraftSnapshot = ''
  surfaceMessage = ''
""",
    "protect schedule editor on close",
)

settings_path.write_text(ts, encoding="utf-8", newline="\n")

# CSS additions
css_path = root / "src" / "settings.css"
css = css_path.read_text(encoding="utf-8")
marker = "/* Timetable management */"
if marker not in css:
    css += """

/* Timetable management */
.record-copy { min-width: 0; }
.record-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.schedule-editor { display: flex; flex-direction: column; gap: 20px; }
.schedule-editor-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; }
.schedule-metadata { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.schedule-metadata div { display: flex; flex-direction: column; gap: 5px; padding: 13px 14px; border-radius: 10px; background: #f5f6f8; }
.schedule-metadata span { color: var(--muted); font-size: 11px; }
.schedule-metadata strong { font-size: 13px; font-weight: 650; }
.editor-note { margin: -6px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.danger-button:disabled { color: #b8bbc1; cursor: default; }
"""
css_path.write_text(css, encoding="utf-8", newline="\n")

# Remove this one-off script after successful application.
Path(__file__).unlink()
print("Applied timetable management changes.")
