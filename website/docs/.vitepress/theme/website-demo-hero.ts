import {
  createButton,
  optionsFor,
  renderLatestWidget,
  type Cleanup,
  type DemoPreset,
} from './website-demo-core'

export function setupStaticHomepageWidget(root: HTMLElement, preset: DemoPreset): Cleanup {
  const stage = root.querySelector<HTMLElement>('.course-stage[data-static-demo="true"]')
  const legacyWidget = stage?.querySelector<HTMLElement>('.widget-window')
  if (!stage || !legacyWidget) return () => undefined
  const legacyClone = legacyWidget.cloneNode(true) as HTMLElement
  const host = document.createElement('div')
  host.className = 'real-widget-host real-widget-host--static'
  legacyWidget.replaceWith(host)
  stage.querySelectorAll('.course-demo-controls, .course-demo-status').forEach((element) => element.remove())
  renderLatestWidget(host, optionsFor(preset, {
    width: 340,
    scale: 0.78,
    followCount: 2,
    showNav: true,
  }), undefined, 'website-real-widget--homepage-static')
  return () => host.replaceWith(legacyClone)
}

export function setupLegacyHeroDemo(
  root: HTMLElement,
  presets: DemoPreset[],
  statusPrefix: string,
): Cleanup {
  const stage = root.querySelector<HTMLElement>('.course-stage')
  const legacyWidget = stage?.querySelector<HTMLElement>('.widget-window')
  if (!stage || !legacyWidget || !presets.length) return () => undefined

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
  const stepButtons = presets.map((preset, index) => {
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
  let activeOptions = optionsFor(presets[currentIndex])
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
    activeOptions = optionsFor(presets[index])
    renderActiveOptions()
    status.textContent = `${statusPrefix} · ${presets[index].label}`
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
    intervalId = window.setInterval(() => renderPreset((currentIndex + 1) % presets.length), 5200)
  }
  const onStepClick = (event: Event) => {
    const index = Number((event.currentTarget as HTMLButtonElement).dataset.demoIndex)
    if (Number.isNaN(index)) return
    renderPreset(index)
    syncTimer()
  }
  const onToggle = () => { userPaused = !userPaused; syncTimer() }
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
