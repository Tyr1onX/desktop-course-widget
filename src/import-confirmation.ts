import type { PreviewCourse } from './schedule-preview'
import './import-confirmation.css'

export type ImportConfirmationChange = {
  courses: PreviewCourse[]
  locationCount: number
  missingCount: number
}

export type ImportConfirmationController = {
  setCourses: (courses: PreviewCourse[]) => void
  clear: () => void
  focus: () => void
}

type LocationState = 'excel' | 'manual' | 'missing'

const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function cloneCourse(course: PreviewCourse): PreviewCourse {
  return {
    ...course,
    weeks: [...course.weeks],
    location: course.location,
  }
}

function compactWeeks(weeks: number[]): string {
  const values = [...new Set(weeks)].filter((week) => week > 0).sort((left, right) => left - right)
  if (values.length === 0) return '周数未填写'

  const ranges: string[] = []
  let start = values[0]
  let end = start

  for (const week of values.slice(1)) {
    if (week === end + 1) {
      end = week
      continue
    }
    ranges.push(start === end ? String(start) : `${start}–${end}`)
    start = week
    end = week
  }
  ranges.push(start === end ? String(start) : `${start}–${end}`)
  return `${ranges.join('、')} 周`
}

function parityLabel(parity: string): string {
  if (parity === 'odd') return ' · 单周'
  if (parity === 'even') return ' · 双周'
  return ''
}

function lessonLabel(course: PreviewCourse): string {
  return course.start_section === course.end_section
    ? `第 ${course.start_section} 节`
    : `第 ${course.start_section}–${course.end_section} 节`
}

function normalizedLocation(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export function mountImportConfirmation(
  container: HTMLElement,
  onChange: (change: ImportConfirmationChange) => void,
): ImportConfirmationController {
  const root = document.createElement('article')
  root.className = 'card card--wide import-confirmation'
  root.hidden = true
  root.innerHTML = `
    <div class="import-confirmation__heading">
      <div>
        <p class="card__eyebrow">可选修正</p>
        <h2>检查并补充课程地点</h2>
        <p>原文件缺少地点时可以保留为空，也可以由你手动补充；程序不会自动猜测。</p>
      </div>
      <label class="import-confirmation__filter" for="confirmation-only-missing">
        <input id="confirmation-only-missing" type="checkbox" />
        <span>仅看地点未填写</span>
      </label>
    </div>
    <div class="import-confirmation__summary" id="confirmation-summary"></div>
    <div class="import-confirmation__list" id="confirmation-list"></div>
    <div class="button-row">
      <button class="button button--primary" id="confirmation-complete" type="button">完成并收起</button>
    </div>
    <p class="inline-message" id="confirmation-message" role="status"></p>
  `
  container.append(root)

  const list = root.querySelector<HTMLElement>('#confirmation-list')
  const summary = root.querySelector<HTMLElement>('#confirmation-summary')
  const onlyMissing = root.querySelector<HTMLInputElement>('#confirmation-only-missing')
  const completeButton = root.querySelector<HTMLButtonElement>('#confirmation-complete')
  const message = root.querySelector<HTMLElement>('#confirmation-message')
  let courses: PreviewCourse[] = []
  let originalLocations: string[] = []

  function locationState(index: number): LocationState {
    const current = normalizedLocation(courses[index]?.location)
    if (!current) return 'missing'
    return current === originalLocations[index] ? 'excel' : 'manual'
  }

  function locationStateCopy(state: LocationState): string {
    if (state === 'excel') return '来自 Excel'
    if (state === 'manual') return '用户补充'
    return '未填写'
  }

  function emitChange(): void {
    const locationCount = courses.filter((course) => normalizedLocation(course.location)).length
    onChange({
      courses: courses.map(cloneCourse),
      locationCount,
      missingCount: courses.length - locationCount,
    })
  }

  function updateSummary(): void {
    if (!summary) return
    const missingCount = courses.filter((course) => !normalizedLocation(course.location)).length
    summary.innerHTML = missingCount > 0
      ? `<strong>${courses.length} 项安排</strong><span>${missingCount} 项地点未填写，可留空直接应用</span>`
      : `<strong>${courses.length} 项安排</strong><span>所有安排都有地点信息</span>`
  }

  function render(): void {
    if (!list) return
    const showOnlyMissing = onlyMissing?.checked ?? false
    list.innerHTML = courses
      .map((course, index) => {
        const state = locationState(index)
        if (showOnlyMissing && state !== 'missing') return ''
        const weekday = weekdayLabels[course.weekday - 1] ?? `星期 ${course.weekday}`
        const location = normalizedLocation(course.location)
        return `
          <section class="import-confirmation__item${state === 'missing' ? ' is-missing' : ''}" data-confirmation-index="${index}">
            <div class="import-confirmation__course">
              <strong>${escapeHtml(course.name)}</strong>
              <span>${escapeHtml(`${weekday} · ${lessonLabel(course)} · ${compactWeeks(course.weeks)}${parityLabel(course.parity)}`)}</span>
            </div>
            <div class="import-confirmation__location">
              <label for="confirmation-location-${index}">
                地点
                <span class="import-confirmation__source is-${state}" data-location-source>${locationStateCopy(state)}</span>
              </label>
              <input
                id="confirmation-location-${index}"
                data-confirmation-location="${index}"
                value="${escapeHtml(location)}"
                maxlength="160"
                placeholder="原文件未填写，可留空"
              />
            </div>
          </section>
        `
      })
      .join('')
    updateSummary()
  }

  list?.addEventListener('input', (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const index = Number(input.dataset.confirmationLocation)
    if (!Number.isInteger(index) || !courses[index]) return

    const value = input.value.trim()
    courses[index].location = value || null
    const item = input.closest<HTMLElement>('[data-confirmation-index]')
    const state = locationState(index)
    item?.classList.toggle('is-missing', state === 'missing')
    const source = item?.querySelector<HTMLElement>('[data-location-source]')
    if (source) {
      source.className = `import-confirmation__source is-${state}`
      source.textContent = locationStateCopy(state)
    }
    updateSummary()
    if (message) message.textContent = ''
    emitChange()
  })

  list?.addEventListener('change', () => {
    if (onlyMissing?.checked) render()
  })

  onlyMissing?.addEventListener('change', render)

  completeButton?.addEventListener('click', () => {
    root.hidden = true
  })

  function setCourses(nextCourses: PreviewCourse[]): void {
    courses = nextCourses.map(cloneCourse)
    originalLocations = courses.map((course) => normalizedLocation(course.location))
    if (onlyMissing) onlyMissing.checked = false
    root.hidden = true
    if (message) message.textContent = ''
    render()
    emitChange()
  }

  function clear(): void {
    courses = []
    originalLocations = []
    root.hidden = true
    if (list) list.replaceChildren()
    if (summary) summary.replaceChildren()
    if (message) message.textContent = ''
  }

  function focus(): void {
    if (courses.length === 0) return
    root.hidden = false
    requestAnimationFrame(() => root.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return { setCourses, clear, focus }
}
