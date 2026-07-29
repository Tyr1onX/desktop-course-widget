import { transitionCourse, type CourseHandoffHandle } from '../../../../src/course-handoff'
import {
  createButton,
  createLatestWidget,
  optionsFor,
  type Cleanup,
  type DemoPreset,
} from './website-demo-core'

export function setupExperienceHeroDemo(
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
  host.dataset.demoTimerState = 'idle'
  host.dataset.demoTransitionState = 'idle'
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
  const activeOptions = optionsFor(presets[currentIndex])
  let timerId: number | undefined
  let activeHandoff: CourseHandoffHandle | undefined
  let requestVersion = 0
  let disposed = false
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

  const stopTimer = () => {
    if (timerId !== undefined) window.clearTimeout(timerId)
    timerId = undefined
    host.dataset.demoTimerState = 'idle'
  }

  const scheduleTimer = () => {
    stopTimer()
    updateControls()
    if (disposed || isPaused() || activeHandoff) return
    host.dataset.demoTimerState = 'scheduled'
    timerId = window.setTimeout(() => {
      timerId = undefined
      host.dataset.demoTimerState = 'idle'
      requestPreset((currentIndex + 1) % presets.length)
    }, 5200)
  }

  const cancelActiveHandoff = (settleTo: 'current' | 'target' = 'target') => {
    const handoff = activeHandoff
    activeHandoff = undefined
    handoff?.cancel(settleTo)
    host.dataset.demoTransitionState = 'idle'
  }

  const buildActiveWidget = () => createLatestWidget(activeOptions, () => {
    userPaused = true
    updateControls()
    requestActiveOptions()
  }, 'website-real-widget--hero')

  const installImmediately = (nextWidget: HTMLElement) => {
    cancelActiveHandoff('target')
    host.replaceChildren(nextWidget)
    host.dataset.demoTransitionState = 'idle'
    scheduleTimer()
  }

  const beginTransition = (nextWidget: HTMLElement, request: number, immediate = false) => {
    stopTimer()
    cancelActiveHandoff('target')
    const currentWidget = host.querySelector<HTMLElement>('.course-widget')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (immediate || !currentWidget || pageHidden || reducedMotion) {
      if (request !== requestVersion || disposed) return
      installImmediately(nextWidget)
      return
    }

    host.dataset.demoTransitionState = 'running'
    const handoff = transitionCourse({
      host,
      currentWidget,
      nextWidget,
      durationScale: 0.7,
      reducedMotion: false,
    })
    activeHandoff = handoff
    void handoff.finished.then(() => {
      if (request !== requestVersion || disposed) return
      if (activeHandoff === handoff) activeHandoff = undefined
      host.dataset.demoTransitionState = 'idle'
      scheduleTimer()
    })
  }

  function requestActiveOptions(immediate = false) {
    const request = ++requestVersion
    beginTransition(buildActiveWidget(), request, immediate)
  }

  function requestPreset(index: number, immediate = false) {
    if (disposed || index < 0 || index >= presets.length) return
    currentIndex = index
    Object.assign(activeOptions, optionsFor(presets[index]))
    status.textContent = `${statusPrefix} · ${presets[index].label}`
    updateControls()
    requestActiveOptions(immediate)
  }

  const onStepClick = (event: Event) => {
    const index = Number((event.currentTarget as HTMLButtonElement).dataset.demoIndex)
    if (!Number.isNaN(index)) requestPreset(index)
  }
  const onToggle = () => { userPaused = !userPaused; scheduleTimer() }
  const onMouseEnter = () => { hoverPaused = true; stopTimer(); updateControls() }
  const onMouseLeave = () => { hoverPaused = false; scheduleTimer() }
  const onVisibilityChange = () => {
    pageHidden = document.hidden
    if (pageHidden) {
      requestVersion += 1
      stopTimer()
      cancelActiveHandoff('target')
      updateControls()
      return
    }
    scheduleTimer()
  }

  stepButtons.forEach((button) => button.addEventListener('click', onStepClick))
  toggleButton.addEventListener('click', onToggle)
  stage.addEventListener('mouseenter', onMouseEnter)
  stage.addEventListener('mouseleave', onMouseLeave)
  document.addEventListener('visibilitychange', onVisibilityChange)
  requestPreset(currentIndex, true)

  return () => {
    disposed = true
    requestVersion += 1
    stopTimer()
    cancelActiveHandoff('target')
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
