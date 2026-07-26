import { createWidget, defaultOptions, type WidgetOptions } from '../../../../src/widget'
import { enhanceTimeFlow } from '../../../../src/time-flow'

type Cleanup = () => void

type DemoPreset = {
  id: string
  label: string
  scenario: WidgetOptions['scenario']
  time: string
}

const heroPresets: DemoPreset[] = [
  { id: 'current', label: '正在上课', scenario: 'current', time: '08:48' },
  { id: 'between', label: '课间等待', scenario: 'between', time: '09:50' },
  { id: 'ended', label: '今日结束', scenario: 'ended', time: '18:40' },
  { id: 'empty', label: '今天无课', scenario: 'empty', time: '12:20' },
]

const storyPresets: DemoPreset[] = [
  { id: 'morning', label: '早晨', scenario: 'current', time: '08:12' },
  { id: 'current', label: '此刻', scenario: 'current', time: '08:48' },
  { id: 'ended', label: '结束', scenario: 'ended', time: '18:40' },
]

const desktopPreset: DemoPreset = {
  id: 'desktop-current',
  label: '桌面运行状态',
  scenario: 'current',
  time: '08:48',
}

function createButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  return button
}

function optionsFor(
  preset: DemoPreset,
  overrides: Partial<WidgetOptions> = {},
): WidgetOptions {
  return {
    ...defaultOptions,
    runtime: 'prototype',
    scenario: preset.scenario,
    theme: 'light',
    background: 'blue',
    width: 360,
    scale: 1,
    followCount: 3,
    showNav: true,
    time: preset.time,
    browsingOffset: 0,
    browseDate: undefined,
    dragRegion: false,
    closeControl: false,
    ...overrides,
  }
}

function renderLatestWidget(
  host: HTMLElement,
  options: WidgetOptions,
  onNavigate?: () => void,
  extraClass?: string,
): HTMLElement {
  const widget = enhanceTimeFlow(createWidget(options, onNavigate), options)
  widget.classList.add('website-real-widget')
  if (extraClass) widget.classList.add(extraClass)
  host.replaceChildren(widget)
  return widget
}

function setupHeroDemo(root: HTMLElement): Cleanup {
  const stage = root.querySelector<HTMLElement>('.course-stage')
  const legacyWidget = stage?.querySelector<HTMLElement>('.widget-window')
  if (!stage || !legacyWidget) return () => undefined

  const legacyClone = legacyWidget.cloneNode(true) as HTMLElement
  const host = document.createElement('div')
  host.className = 'real-widget-host'
  legacyWidget.replaceWith(host)
  stage.querySelectorAll('.course-demo-controls, .course-demo-status').forEach((element) => element.remove())

  const status = document.createElement('div')
  status.className = 'course-demo-status'
  status.setAttribute('aria-live', 'polite')

  const controls = document.createElement('div')
  controls.className = 'course-demo-controls'
  controls.setAttribute('aria-label', '课刻最新版运行状态演示控制')

  const stepButtons = heroPresets.map((preset, index) => {
    const button = createButton('course-demo-step', `查看${preset.label}状态`)
    button.dataset.demoIndex = String(index)
    button.title = preset.label
    controls.append(button)
    return button
  })

  const toggleButton = createButton('course-demo-toggle', '暂停自动演示')
  toggleButton.textContent = '暂停'
  controls.append(toggleButton)
  stage.append(status, controls)

  let currentIndex = 0
  let activeOptions = optionsFor(heroPresets[currentIndex])
  let intervalId: number | undefined
  let transitionId: number | undefined
  let userPaused = false
  let hoverPaused = false
  let pageHidden = document.hidden

  const isPaused = () => userPaused || hoverPaused || pageHidden

  const updateControls = () => {
    stepButtons.forEach((button, index) => {
      button.classList.toggle('is-active', index === currentIndex)
      if (index === currentIndex) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    })
    toggleButton.textContent = userPaused ? '继续' : '暂停'
    toggleButton.setAttribute('aria-label', userPaused ? '继续自动演示' : '暂停自动演示')
    controls.classList.toggle('is-paused', isPaused())
  }

  const renderActiveOptions = () => {
    renderLatestWidget(host, activeOptions, () => {
      userPaused = true
      renderActiveOptions()
      syncTimer()
    }, 'website-real-widget--hero')
  }

  const applyPreset = (index: number) => {
    currentIndex = index
    activeOptions = optionsFor(heroPresets[index])
    renderActiveOptions()
    status.textContent = `当前桌面组件 · ${heroPresets[index].label}`
    updateControls()
  }

  const renderPreset = (index: number, immediate = false) => {
    if (transitionId !== undefined) window.clearTimeout(transitionId)
    if (immediate) {
      applyPreset(index)
      return
    }
    host.classList.add('is-real-transitioning')
    transitionId = window.setTimeout(() => {
      applyPreset(index)
      host.classList.remove('is-real-transitioning')
      transitionId = undefined
    }, 150)
  }

  const stopTimer = () => {
    if (intervalId !== undefined) window.clearInterval(intervalId)
    intervalId = undefined
  }

  function syncTimer() {
    stopTimer()
    updateControls()
    if (isPaused()) return
    intervalId = window.setInterval(() => {
      renderPreset((currentIndex + 1) % heroPresets.length)
    }, 5200)
  }

  const onStepClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    const index = Number(button.dataset.demoIndex)
    if (Number.isNaN(index)) return
    renderPreset(index)
    syncTimer()
  }

  const onToggle = () => {
    userPaused = !userPaused
    syncTimer()
  }
  const onMouseEnter = () => { hoverPaused = true; syncTimer() }
  const onMouseLeave = () => { hoverPaused = false; syncTimer() }
  const onVisibilityChange = () => { pageHidden = document.hidden; syncTimer() }

  stepButtons.forEach((button) => button.addEventListener('click', onStepClick))
  toggleButton.addEventListener('click', onToggle)
  stage.addEventListener('mouseenter', onMouseEnter)
  stage.addEventListener('mouseleave', onMouseLeave)
  document.addEventListener('visibilitychange', onVisibilityChange)

  renderPreset(currentIndex, true)
  syncTimer()

  return () => {
    stopTimer()
    if (transitionId !== undefined) window.clearTimeout(transitionId)
    stepButtons.forEach((button) => button.removeEventListener('click', onStepClick))
    toggleButton.removeEventListener('click', onToggle)
    stage.removeEventListener('mouseenter', onMouseEnter)
    stage.removeEventListener('mouseleave', onMouseLeave)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    status.remove()
    controls.remove()
    host.replaceWith(legacyClone)
  }
}

function setupStoryWidgets(root: HTMLElement): Cleanup {
  const moments = Array.from(root.querySelectorAll<HTMLElement>('.day-flow .day-moment'))
  if (moments.length < storyPresets.length) return () => undefined

  const originals = moments.map((moment) => {
    const visual = moment.querySelector<HTMLElement>('.day-moment__visual')
    return visual ? { visual, html: visual.innerHTML, className: visual.className } : null
  })

  originals.forEach((entry, index) => {
    if (!entry || !storyPresets[index]) return
    entry.visual.className = `${entry.className} has-real-widget`
    const options = optionsFor(storyPresets[index], {
      width: 360,
      scale: 0.82,
      followCount: 1,
      showNav: false,
    })
    renderLatestWidget(entry.visual, options, undefined, 'website-real-widget--story')
  })

  return () => {
    originals.forEach((entry) => {
      if (!entry) return
      entry.visual.className = entry.className
      entry.visual.innerHTML = entry.html
    })
  }
}

function setupTrayDemo(root: HTMLElement): Cleanup {
  const visual = root.querySelector<HTMLElement>('.course-focus__visual')
  const desktop = visual?.querySelector<HTMLElement>('.focus-desktop')
  const widgetShell = desktop?.querySelector<HTMLElement>('.focus-desktop__widget')
  const tray = desktop?.querySelector<HTMLElement>('.focus-desktop__tray')
  if (!visual || !desktop || !widgetShell || !tray) return () => undefined

  const originalHtml = widgetShell.innerHTML
  const originalClass = widgetShell.className
  const options = optionsFor(desktopPreset, {
    theme: 'dark',
    width: 360,
    scale: 0.92,
    followCount: 2,
    showNav: true,
    closeControl: true,
  })

  visual.removeAttribute('aria-hidden')
  visual.setAttribute('aria-label', '课刻最新版窗口关闭到系统托盘并重新打开的交互演示')
  widgetShell.classList.add('focus-desktop__widget--real')

  desktop.querySelectorAll('.focus-desktop__tray-app, .focus-desktop__demo-hint').forEach((element) => element.remove())
  const iconSource = root.querySelector<HTMLImageElement>('.course-brand img')?.src ?? ''
  const trayButton = createButton('focus-desktop__tray-app', '从系统托盘打开课刻')
  trayButton.innerHTML = iconSource ? `<img src="${iconSource}" alt="" />` : '<span aria-hidden="true"></span>'
  tray.prepend(trayButton)

  const hint = document.createElement('p')
  hint.className = 'focus-desktop__demo-hint'
  desktop.append(hint)

  let visible = true
  let userInteracted = false
  let autoHideId: number | undefined
  let autoShowId: number | undefined
  let observer: IntersectionObserver | undefined
  let closeButton: HTMLButtonElement | null = null

  const clearTimers = () => {
    if (autoHideId !== undefined) window.clearTimeout(autoHideId)
    if (autoShowId !== undefined) window.clearTimeout(autoShowId)
    autoHideId = undefined
    autoShowId = undefined
  }

  const setVisible = (nextVisible: boolean, fromUser = false) => {
    visible = nextVisible
    if (fromUser) {
      userInteracted = true
      clearTimers()
    }
    desktop.classList.toggle('is-widget-hidden', !visible)
    widgetShell.setAttribute('aria-hidden', String(!visible))
    trayButton.classList.toggle('is-active', !visible)
    trayButton.setAttribute('aria-expanded', String(visible))
    hint.textContent = visible
      ? '点击课刻窗口中的 ×，窗口会隐藏到系统托盘'
      : '课刻已隐藏 · 点击托盘图标重新显示'
  }

  const onClose = () => setVisible(false, true)
  const bindClose = () => {
    closeButton?.removeEventListener('click', onClose)
    closeButton = widgetShell.querySelector<HTMLButtonElement>('[data-hide]')
    closeButton?.addEventListener('click', onClose)
  }

  const renderDesktopWidget = () => {
    renderLatestWidget(widgetShell, options, renderDesktopWidget, 'website-real-widget--desktop')
    bindClose()
  }

  const onTray = () => setVisible(true, true)
  renderDesktopWidget()
  trayButton.addEventListener('click', onTray)
  setVisible(true)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduceMotion && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      if (userInteracted || !entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.55)) return
      observer?.disconnect()
      autoHideId = window.setTimeout(() => setVisible(false), 1800)
      autoShowId = window.setTimeout(() => setVisible(true), 4100)
    }, { threshold: [0.55] })
    observer.observe(desktop)
  }

  return () => {
    clearTimers()
    observer?.disconnect()
    closeButton?.removeEventListener('click', onClose)
    trayButton.removeEventListener('click', onTray)
    trayButton.remove()
    hint.remove()
    desktop.classList.remove('is-widget-hidden')
    widgetShell.className = originalClass
    widgetShell.innerHTML = originalHtml
    widgetShell.removeAttribute('aria-hidden')
    visual.setAttribute('aria-hidden', 'true')
    visual.removeAttribute('aria-label')
  }
}

export function setupWebsiteDemo(): Cleanup {
  const root = document.querySelector<HTMLElement>('.course-home')
  if (!root) return () => undefined
  const cleanups = [setupHeroDemo(root), setupStoryWidgets(root), setupTrayDemo(root)]
  return () => cleanups.forEach((cleanup) => cleanup())
}
