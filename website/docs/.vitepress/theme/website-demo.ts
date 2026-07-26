type Cleanup = () => void

type DemoCourse = {
  start: string
  end: string
  label: string
  title: string
  location: string
}

type DemoState = {
  id: string
  label: string
  chromeTime: string
  nowText: string
  activeCourse: number | null
  courses: [DemoCourse, DemoCourse]
  footerLeft: string
  footerRight: string
}

const demoStates: DemoState[] = [
  {
    id: 'morning',
    label: '早晨',
    chromeTime: '08:10',
    nowText: '今天 · 08:10',
    activeCourse: 0,
    courses: [
      {
        start: '09:00',
        end: '10:35',
        label: '第一节',
        title: '数字信号处理',
        location: '逸夫教学楼 · B311',
      },
      {
        start: '10:50',
        end: '12:25',
        label: '之后',
        title: '通信原理',
        location: '李四光楼 · 201',
      },
    ],
    footerLeft: '今天有 3 节课',
    footerRight: '50 分钟后开始',
  },
  {
    id: 'current',
    label: '正在上课',
    chromeTime: '09:42',
    nowText: '现在 · 09:42',
    activeCourse: 0,
    courses: [
      {
        start: '09:00',
        end: '10:35',
        label: '正在上课',
        title: '数字信号处理',
        location: '逸夫教学楼 · B311',
      },
      {
        start: '10:50',
        end: '12:25',
        label: '接下来',
        title: '通信原理',
        location: '李四光楼 · 201',
      },
    ],
    footerLeft: '今天还有 2 节课',
    footerRight: '还有 53 分钟',
  },
  {
    id: 'between',
    label: '课间',
    chromeTime: '10:36',
    nowText: '课间 · 10:36',
    activeCourse: 1,
    courses: [
      {
        start: '09:00',
        end: '10:35',
        label: '刚刚结束',
        title: '数字信号处理',
        location: '逸夫教学楼 · B311',
      },
      {
        start: '10:50',
        end: '12:25',
        label: '下一节',
        title: '通信原理',
        location: '李四光楼 · 201',
      },
    ],
    footerLeft: '下一节即将开始',
    footerRight: '还有 14 分钟',
  },
  {
    id: 'evening',
    label: '课程结束',
    chromeTime: '17:20',
    nowText: '今天 · 17:20',
    activeCourse: null,
    courses: [
      {
        start: '今天',
        end: '完成',
        label: '课程结束',
        title: '明天见。',
        location: '桌面重新安静下来',
      },
      {
        start: '08:00',
        end: '09:35',
        label: '明天第一节',
        title: '高频电子技术',
        location: '逸夫教学楼 · A205',
      },
    ],
    footerLeft: '今天的课程已经结束',
    footerRight: '明天有 2 节课',
  },
]

function createButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  return button
}

function updateCourse(element: HTMLElement, course: DemoCourse, isActive: boolean): void {
  const times = element.querySelectorAll<HTMLElement>('.widget-course__time > *')
  const label = element.querySelector<HTMLElement>('.widget-course__content > span')
  const title = element.querySelector<HTMLElement>('.widget-course__content > strong')
  const location = element.querySelector<HTMLElement>('.widget-course__content > p')

  if (times[0]) times[0].textContent = course.start
  if (times[1]) times[1].textContent = course.end
  if (label) label.textContent = course.label
  if (title) title.textContent = course.title
  if (location) location.textContent = course.location

  element.classList.toggle('widget-course--active', isActive)
}

function setupHeroDemo(root: HTMLElement): Cleanup {
  const stage = root.querySelector<HTMLElement>('.course-stage')
  const widget = stage?.querySelector<HTMLElement>('.widget-window')
  if (!stage || !widget) return () => undefined

  stage.querySelectorAll('.course-demo-controls, .course-demo-status').forEach((element) => element.remove())

  const chromeTime = stage.querySelector<HTMLElement>('.course-stage__chrome > span')
  const nowText = widget.querySelector<HTMLElement>('.widget-now span:last-child')
  const courses = Array.from(widget.querySelectorAll<HTMLElement>('.widget-course'))
  const footerItems = widget.querySelectorAll<HTMLElement>('.widget-window__footer span')

  if (courses.length < 2) return () => undefined

  const status = document.createElement('div')
  status.className = 'course-demo-status'
  status.setAttribute('aria-live', 'polite')

  const controls = document.createElement('div')
  controls.className = 'course-demo-controls'
  controls.setAttribute('aria-label', '课刻状态演示控制')

  const stepButtons = demoStates.map((state, index) => {
    const button = createButton('course-demo-step', `查看${state.label}状态`)
    button.dataset.demoIndex = String(index)
    button.title = state.label
    controls.append(button)
    return button
  })

  const toggleButton = createButton('course-demo-toggle', '暂停自动演示')
  toggleButton.textContent = '暂停'
  controls.append(toggleButton)

  stage.append(status, controls)

  let currentIndex = 1
  let intervalId: number | undefined
  let transitionId: number | undefined
  let userPaused = false
  let hoverPaused = false
  let pageHidden = document.hidden

  const isPaused = () => userPaused || hoverPaused || pageHidden

  const updateControls = () => {
    stepButtons.forEach((button, index) => {
      const active = index === currentIndex
      button.classList.toggle('is-active', active)
      if (active) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    })

    toggleButton.textContent = userPaused ? '继续' : '暂停'
    toggleButton.setAttribute('aria-label', userPaused ? '继续自动演示' : '暂停自动演示')
    controls.classList.toggle('is-paused', isPaused())
  }

  const applyState = (index: number) => {
    const state = demoStates[index]
    currentIndex = index
    widget.dataset.demoMode = state.id
    if (chromeTime) chromeTime.textContent = state.chromeTime
    if (nowText) nowText.textContent = state.nowText

    updateCourse(courses[0], state.courses[0], state.activeCourse === 0)
    updateCourse(courses[1], state.courses[1], state.activeCourse === 1)

    if (footerItems[0]) footerItems[0].textContent = state.footerLeft
    if (footerItems[1]) footerItems[1].textContent = state.footerRight

    status.textContent = `自动演示 · ${state.label}`
    updateControls()
  }

  const renderState = (index: number, immediate = false) => {
    if (transitionId !== undefined) window.clearTimeout(transitionId)

    if (immediate) {
      applyState(index)
      return
    }

    widget.classList.add('is-demo-transitioning')
    transitionId = window.setTimeout(() => {
      applyState(index)
      widget.classList.remove('is-demo-transitioning')
      transitionId = undefined
    }, 190)
  }

  const stopTimer = () => {
    if (intervalId !== undefined) {
      window.clearInterval(intervalId)
      intervalId = undefined
    }
  }

  const syncTimer = () => {
    stopTimer()
    updateControls()
    if (isPaused()) return

    intervalId = window.setInterval(() => {
      renderState((currentIndex + 1) % demoStates.length)
    }, 4300)
  }

  const onStepClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    const index = Number(button.dataset.demoIndex)
    if (!Number.isNaN(index)) renderState(index)
    syncTimer()
  }

  stepButtons.forEach((button) => button.addEventListener('click', onStepClick))

  const onToggle = () => {
    userPaused = !userPaused
    syncTimer()
  }

  const onMouseEnter = () => {
    hoverPaused = true
    syncTimer()
  }

  const onMouseLeave = () => {
    hoverPaused = false
    syncTimer()
  }

  const onVisibilityChange = () => {
    pageHidden = document.hidden
    syncTimer()
  }

  toggleButton.addEventListener('click', onToggle)
  stage.addEventListener('mouseenter', onMouseEnter)
  stage.addEventListener('mouseleave', onMouseLeave)
  document.addEventListener('visibilitychange', onVisibilityChange)

  renderState(currentIndex, true)
  syncTimer()

  return () => {
    stopTimer()
    if (transitionId !== undefined) window.clearTimeout(transitionId)
    stepButtons.forEach((button) => button.removeEventListener('click', onStepClick))
    toggleButton.removeEventListener('click', onToggle)
    stage.removeEventListener('mouseenter', onMouseEnter)
    stage.removeEventListener('mouseleave', onMouseLeave)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    controls.remove()
    status.remove()
    widget.classList.remove('is-demo-transitioning')
    delete widget.dataset.demoMode
  }
}

function setupTrayDemo(root: HTMLElement): Cleanup {
  const visual = root.querySelector<HTMLElement>('.course-focus__visual')
  const desktop = visual?.querySelector<HTMLElement>('.focus-desktop')
  const widget = desktop?.querySelector<HTMLElement>('.focus-desktop__widget')
  const tray = desktop?.querySelector<HTMLElement>('.focus-desktop__tray')

  if (!visual || !desktop || !widget || !tray) return () => undefined

  visual.removeAttribute('aria-hidden')
  visual.setAttribute('aria-label', '课刻关闭到系统托盘并重新打开的交互演示')

  desktop.querySelectorAll('.focus-desktop__close, .focus-desktop__tray-app, .focus-desktop__demo-hint').forEach((element) => element.remove())

  const closeButton = createButton('focus-desktop__close', '关闭课刻到系统托盘')
  closeButton.textContent = '×'
  widget.append(closeButton)

  const trayButton = createButton('focus-desktop__tray-app', '从系统托盘打开课刻')
  trayButton.innerHTML = '<span aria-hidden="true"></span>'
  tray.prepend(trayButton)

  const hint = document.createElement('p')
  hint.className = 'focus-desktop__demo-hint'
  hint.textContent = '点击 × 关闭，再从托盘唤回'
  desktop.append(hint)

  let visible = true
  let userInteracted = false
  let autoHideId: number | undefined
  let autoShowId: number | undefined
  let observer: IntersectionObserver | undefined

  const clearAutoTimers = () => {
    if (autoHideId !== undefined) window.clearTimeout(autoHideId)
    if (autoShowId !== undefined) window.clearTimeout(autoShowId)
    autoHideId = undefined
    autoShowId = undefined
  }

  const setVisible = (nextVisible: boolean, fromUser = false) => {
    visible = nextVisible
    if (fromUser) {
      userInteracted = true
      clearAutoTimers()
    }

    desktop.classList.toggle('is-widget-hidden', !visible)
    widget.setAttribute('aria-hidden', String(!visible))
    trayButton.classList.toggle('is-active', !visible)
    trayButton.setAttribute('aria-expanded', String(visible))
    hint.textContent = visible
      ? '点击 × 关闭，再从托盘唤回'
      : '课刻已回到系统托盘 · 点击蓝色图标唤回'
  }

  const onClose = () => setVisible(false, true)
  const onTray = () => setVisible(true, true)

  closeButton.addEventListener('click', onClose)
  trayButton.addEventListener('click', onTray)
  setVisible(true)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduceMotion && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        if (userInteracted || !entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.55)) return
        observer?.disconnect()
        autoHideId = window.setTimeout(() => setVisible(false), 1500)
        autoShowId = window.setTimeout(() => setVisible(true), 3500)
      },
      { threshold: [0.55] },
    )
    observer.observe(desktop)
  }

  return () => {
    clearAutoTimers()
    observer?.disconnect()
    closeButton.removeEventListener('click', onClose)
    trayButton.removeEventListener('click', onTray)
    closeButton.remove()
    trayButton.remove()
    hint.remove()
    desktop.classList.remove('is-widget-hidden')
    widget.removeAttribute('aria-hidden')
    visual.setAttribute('aria-hidden', 'true')
    visual.removeAttribute('aria-label')
  }
}

export function setupWebsiteDemo(): Cleanup {
  const root = document.querySelector<HTMLElement>('.course-home')
  if (!root) return () => undefined

  const cleanups = [setupHeroDemo(root), setupTrayDemo(root)]
  return () => cleanups.forEach((cleanup) => cleanup())
}
