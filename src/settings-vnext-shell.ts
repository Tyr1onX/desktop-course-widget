import './settings-vnext-shell.css'

const app = document.querySelector<HTMLDivElement>('#app')
let enhanceQueued = false

function text(element: Element | null): string {
  return element?.textContent?.trim() ?? ''
}

function weekRangeText(main: HTMLElement): string {
  const firstMonth = Number(text(main.querySelector('.month-heading strong')))
  const days = Array.from(main.querySelectorAll<HTMLElement>('.day-heading strong'))
    .map((item) => Number(text(item)))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (!firstMonth || days.length < 2) return '本周课程安排'

  const firstDay = days[0]
  const lastDay = days.at(-1) ?? firstDay
  const lastMonth = lastDay < firstDay ? (firstMonth % 12) + 1 : firstMonth
  return `${firstMonth}月${firstDay}日 – ${lastMonth}月${lastDay}日`
}

function activeRoute(main: HTMLElement): 'week' | 'import' | 'data' | 'times' {
  const surface = main.querySelector<HTMLElement>('.side-surface')
  const label = surface?.getAttribute('aria-label') ?? ''
  if (label.includes('导入')) return 'import'
  if (label.includes('课表与数据') || label.includes('编辑课表')) return 'data'
  if (label.includes('作息时间')) return 'times'
  return 'week'
}

function updateShell(main: HTMLElement): void {
  const rail = main.querySelector<HTMLElement>('.settings-rail')
  if (!rail) return

  const scheduleName = text(main.querySelector('.schedule-selector-copy strong')) || '当前课表'
  const weekLabel = text(main.querySelector('.week-label')) || '教学周'
  const range = weekRangeText(main)
  const route = activeRoute(main)

  const identityName = rail.querySelector<HTMLElement>('[data-vnext-schedule-name]')
  const identityMeta = rail.querySelector<HTMLElement>('[data-vnext-schedule-meta]')
  const toolbarTitle = main.querySelector<HTMLElement>('[data-vnext-page-title]')
  const toolbarMeta = main.querySelector<HTMLElement>('[data-vnext-page-meta]')

  if (identityName && identityName.textContent !== scheduleName) identityName.textContent = scheduleName
  if (identityMeta && identityMeta.textContent !== weekLabel) identityMeta.textContent = weekLabel
  if (toolbarTitle && toolbarTitle.textContent !== '周课表') toolbarTitle.textContent = '周课表'
  if (toolbarMeta && toolbarMeta.textContent !== range) toolbarMeta.textContent = range

  rail.querySelectorAll<HTMLButtonElement>('[data-vnext-route]').forEach((button) => {
    const active = button.dataset.vnextRoute === route
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-current', active ? 'page' : 'false')
  })
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

async function openScheduleMenuSurface(surface: 'import' | 'data'): Promise<void> {
  const existing = app?.querySelector<HTMLButtonElement>(`[data-open-surface="${surface}"]`)
  if (existing) {
    existing.click()
    return
  }

  app?.querySelector<HTMLButtonElement>('[data-action="toggle-schedule-menu"]')?.click()
  await waitFrame()
  app?.querySelector<HTMLButtonElement>(`[data-open-surface="${surface}"]`)?.click()
}

async function openMoreMenuSurface(surface: 'times'): Promise<void> {
  const existing = app?.querySelector<HTMLButtonElement>(`[data-open-surface="${surface}"]`)
  if (existing) {
    existing.click()
    return
  }

  app?.querySelector<HTMLButtonElement>('[data-action="toggle-menu"]')?.click()
  await waitFrame()
  app?.querySelector<HTMLButtonElement>(`[data-open-surface="${surface}"]`)?.click()
}

function showWeekView(): void {
  const close = app?.querySelector<HTMLButtonElement>('[data-action="close-surface"]')
  if (close) {
    close.click()
    return
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

function bindRail(rail: HTMLElement): void {
  if (rail.dataset.vnextBound === 'true') return
  rail.dataset.vnextBound = 'true'
  rail.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-vnext-route]')
      : null
    const route = target?.dataset.vnextRoute
    if (!route) return
    if (route === 'week') showWeekView()
    if (route === 'import' || route === 'data') void openScheduleMenuSurface(route)
    if (route === 'times') void openMoreMenuSurface(route)
  })
}

function buildRail(main: HTMLElement): HTMLElement {
  const rail = document.createElement('aside')
  rail.className = 'settings-rail'
  rail.setAttribute('aria-label', '课刻导航')
  rail.innerHTML = `
    <div class="settings-rail-brand">
      <span class="settings-rail-mark" aria-hidden="true">课</span>
      <span><strong>课刻</strong><small>Course Widget</small></span>
    </div>
    <nav class="settings-rail-nav" aria-label="主要功能">
      <button type="button" data-vnext-route="week"><span aria-hidden="true">▦</span><strong>周课表</strong></button>
      <button type="button" data-vnext-route="import"><span aria-hidden="true">↥</span><strong>导入课表</strong></button>
      <button type="button" data-vnext-route="data"><span aria-hidden="true">≡</span><strong>课表管理</strong></button>
      <button type="button" data-vnext-route="times"><span aria-hidden="true">◷</span><strong>作息时间</strong></button>
    </nav>
    <div class="settings-rail-spacer"></div>
    <div class="settings-rail-schedule-slot"></div>
    <div class="settings-rail-identity">
      <span class="settings-rail-identity-dot" aria-hidden="true"></span>
      <span class="settings-rail-identity-copy">
        <strong data-vnext-schedule-name>当前课表</strong>
        <small data-vnext-schedule-meta>教学周</small>
      </span>
    </div>
  `

  const selector = main.querySelector<HTMLElement>('.schedule-selector-wrap')
  const slot = rail.querySelector<HTMLElement>('.settings-rail-schedule-slot')
  if (selector && slot) slot.append(selector)
  bindRail(rail)
  return rail
}

function buildToolbarCopy(toolbar: HTMLElement): HTMLElement {
  const copy = document.createElement('div')
  copy.className = 'vnext-toolbar-copy'
  copy.innerHTML = `
    <strong data-vnext-page-title>周课表</strong>
    <span data-vnext-page-meta>本周课程安排</span>
  `
  toolbar.prepend(copy)
  return copy
}

function enhanceShell(): void {
  enhanceQueued = false
  const main = app?.querySelector<HTMLElement>('.settings-app')
  if (!main) return

  const existingRail = main.querySelector<HTMLElement>('.settings-rail')
  if (existingRail) {
    updateShell(main)
    return
  }

  const toolbar = main.querySelector<HTMLElement>('.schedule-toolbar')
  if (!toolbar) return

  main.classList.add('settings-app--vnext')
  main.prepend(buildRail(main))
  if (!toolbar.querySelector('.vnext-toolbar-copy')) buildToolbarCopy(toolbar)
  updateShell(main)
}

function queueEnhance(): void {
  if (enhanceQueued) return
  enhanceQueued = true
  window.requestAnimationFrame(enhanceShell)
}

if (app) {
  new MutationObserver(queueEnhance).observe(app, { childList: true, subtree: true, characterData: true })
  queueEnhance()
}
