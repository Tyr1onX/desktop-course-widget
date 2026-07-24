import './schedule-preview.css'

export type PreviewCourse = {
  code: string | null
  name: string
  weekday: number
  start_section: number
  end_section: number
  weeks: number[]
  parity: string
  location: string | null
}

export type SchedulePreviewController = {
  setData: (courses: PreviewCourse[], highestWeek: number) => void
  clear: () => void
  open: () => boolean
  close: () => void
}

const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function hueForName(name: string): number {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % 360
}

function firstAvailableWeek(courses: PreviewCourse[]): number {
  const weeks = courses.flatMap((course) => course.weeks).filter((week) => week > 0)
  return weeks.length > 0 ? Math.min(...weeks) : 1
}

export function mountSchedulePreview(): SchedulePreviewController {
  const root = document.createElement('div')
  root.className = 'schedule-preview'
  root.hidden = true
  root.innerHTML = `
    <button class="schedule-preview__backdrop" type="button" aria-label="关闭课表预览" data-preview-close></button>
    <section class="schedule-preview__panel" role="dialog" aria-modal="true" aria-labelledby="schedule-preview-title">
      <header class="schedule-preview__header">
        <div>
          <p class="schedule-preview__eyebrow">导入检查</p>
          <h2 id="schedule-preview-title">每周课表预览</h2>
          <p>按周检查课程名称、星期、节次和地点。当前只预览，不会写入正式课表。</p>
        </div>
        <button class="schedule-preview__close" type="button" aria-label="关闭课表预览" data-preview-close>×</button>
      </header>

      <div class="schedule-preview__toolbar">
        <button class="button button--secondary" id="preview-previous-week" type="button">上一周</button>
        <label class="schedule-preview__week-label" for="preview-week">
          教学周
          <select id="preview-week"></select>
        </label>
        <button class="button button--secondary" id="preview-next-week" type="button">下一周</button>
        <span class="schedule-preview__count" id="preview-course-count"></span>
      </div>

      <div class="schedule-preview__scroll">
        <div class="schedule-preview__grid" id="preview-grid"></div>
      </div>

      <footer class="schedule-preview__footer">
        <span>课程块跨越的行数就是对应节次数。</span>
        <button class="button button--primary" type="button" data-preview-close>返回设置</button>
      </footer>
    </section>
  `
  document.body.append(root)

  const grid = root.querySelector<HTMLElement>('#preview-grid')
  const weekSelect = root.querySelector<HTMLSelectElement>('#preview-week')
  const previousButton = root.querySelector<HTMLButtonElement>('#preview-previous-week')
  const nextButton = root.querySelector<HTMLButtonElement>('#preview-next-week')
  const courseCount = root.querySelector<HTMLElement>('#preview-course-count')
  let courses: PreviewCourse[] = []
  let highestWeek = 1

  function selectedWeek(): number {
    const value = Number(weekSelect?.value)
    return Number.isInteger(value) && value > 0 ? value : 1
  }

  function render(): void {
    if (!grid || !weekSelect) return
    const week = selectedWeek()
    const activeCourses = courses.filter((course) => course.weeks.includes(week))
    const groups = new Map<string, PreviewCourse[]>()

    for (const course of activeCourses) {
      const key = `${course.weekday}:${course.start_section}:${course.end_section}`
      const group = groups.get(key) ?? []
      group.push(course)
      groups.set(key, group)
    }

    const headers = weekdayLabels
      .map((label, index) => `<div class="schedule-preview__day" style="grid-column:${index + 2};grid-row:1">${label}</div>`)
      .join('')
    const sectionLabels = Array.from(
      { length: 10 },
      (_, index) => `<div class="schedule-preview__section" style="grid-column:1;grid-row:${index + 2}">第 ${index + 1} 节</div>`,
    ).join('')
    const cells = Array.from({ length: 70 }, (_, index) => {
      const day = index % 7
      const section = Math.floor(index / 7)
      return `<div class="schedule-preview__cell" style="grid-column:${day + 2};grid-row:${section + 2}"></div>`
    }).join('')
    const blocks = [...groups.values()]
      .map((group) => {
        const first = group[0]
        if (!first) return ''
        const entries = group
          .map((course) => {
            const location = course.location?.trim()
              ? `<span class="schedule-preview__location">${escapeHtml(course.location.trim())}</span>`
              : '<span class="schedule-preview__location schedule-preview__location--empty">地点未填写</span>'
            return `<div class="schedule-preview__entry"><strong>${escapeHtml(course.name)}</strong>${location}</div>`
          })
          .join('')
        const sectionText =
          first.start_section === first.end_section
            ? `第 ${first.start_section} 节`
            : `第 ${first.start_section}–${first.end_section} 节`
        return `
          <article
            class="schedule-preview__course"
            style="grid-column:${first.weekday + 1};grid-row:${first.start_section + 1} / ${first.end_section + 2};--course-hue:${hueForName(first.name)}"
            title="${escapeHtml(sectionText)}"
          >
            ${entries}
            <span class="schedule-preview__sections">${sectionText}</span>
          </article>
        `
      })
      .join('')

    grid.innerHTML = `<div class="schedule-preview__corner" style="grid-column:1;grid-row:1">节次</div>${headers}${sectionLabels}${cells}${blocks}`
    if (courseCount) courseCount.textContent = activeCourses.length > 0 ? `本周 ${activeCourses.length} 项安排` : '本周没有课程'
    if (previousButton) previousButton.disabled = week <= 1
    if (nextButton) nextButton.disabled = week >= highestWeek
  }

  function setData(nextCourses: PreviewCourse[], nextHighestWeek: number): void {
    courses = nextCourses
    highestWeek = Math.max(1, nextHighestWeek)
    if (weekSelect) {
      weekSelect.innerHTML = Array.from(
        { length: highestWeek },
        (_, index) => `<option value="${index + 1}">第 ${index + 1} 周</option>`,
      ).join('')
      weekSelect.value = String(Math.min(firstAvailableWeek(courses), highestWeek))
    }
    render()
  }

  function clear(): void {
    courses = []
    highestWeek = 1
    if (weekSelect) weekSelect.innerHTML = '<option value="1">第 1 周</option>'
    root.hidden = true
  }

  function open(): boolean {
    if (courses.length === 0) return false
    render()
    root.hidden = false
    root.querySelector<HTMLButtonElement>('[data-preview-close]')?.focus()
    return true
  }

  function close(): void {
    root.hidden = true
  }

  weekSelect?.addEventListener('change', render)
  previousButton?.addEventListener('click', () => {
    if (!weekSelect) return
    weekSelect.value = String(Math.max(1, selectedWeek() - 1))
    render()
  })
  nextButton?.addEventListener('click', () => {
    if (!weekSelect) return
    weekSelect.value = String(Math.min(highestWeek, selectedWeek() + 1))
    render()
  })
  for (const closeButton of root.querySelectorAll<HTMLButtonElement>('[data-preview-close]')) {
    closeButton.addEventListener('click', close)
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) close()
  })

  clear()
  return { setData, clear, open, close }
}
