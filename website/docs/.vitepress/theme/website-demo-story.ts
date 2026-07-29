import {
  createButton,
  desktopPreset,
  optionsFor,
  renderLatestWidget,
  storyPresets,
  type Cleanup,
} from './website-demo-core'

export function setupStoryWidgets(root: HTMLElement): Cleanup {
  const moments = Array.from(root.querySelectorAll<HTMLElement>('.day-flow .day-moment'))
  if (moments.length < storyPresets.length) return () => undefined
  const originals = moments.map((moment) => {
    const visual = moment.querySelector<HTMLElement>('.day-moment__visual')
    return visual ? { visual, html: visual.innerHTML, className: visual.className } : null
  })
  originals.forEach((entry, index) => {
    if (!entry || !storyPresets[index]) return
    entry.visual.className = `${entry.className} has-real-widget`
    renderLatestWidget(entry.visual, optionsFor(storyPresets[index], {
      width: 360,
      scale: 0.82,
      followCount: 1,
      showNav: false,
    }), undefined, 'website-real-widget--story')
  })
  return () => originals.forEach((entry) => {
    if (!entry) return
    entry.visual.className = entry.className
    entry.visual.innerHTML = entry.html
  })
}

export function setupTrayDemo(root: HTMLElement): Cleanup {
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

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
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
