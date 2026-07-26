type Cleanup = () => void

type RealCourse = {
  start: string
  end: string
  name: string
  location: string
}

type RealFocus = RealCourse & {
  kicker: string
  courseDate?: string
  countdown?: string
  progress?: number
  current?: boolean
  urgency?: 'soon' | 'imminent'
}

type RealWidgetState = {
  id: string
  label: string
  tone: 'morning' | 'day' | 'evening' | 'night'
  title: string
  dateLine: string
  now: string
  today?: boolean
  stateLabel?: string
  emptyMessage?: string
  focus?: RealFocus
  following?: RealCourse[]
}

type WidgetMarkupOptions = {
  theme?: 'light' | 'dark'
  closeControl?: boolean
  compact?: boolean
}

const mondayCourses: RealCourse[] = [
  { start: '08:00', end: '09:40', name: '高等数学', location: '教学楼 A101' },
  { start: '10:00', end: '11:40', name: '大学英语', location: '教学楼 A101' },
  { start: '13:30', end: '15:10', name: '程序设计基础', location: '实验楼 B203' },
  { start: '15:30', end: '17:10', name: '计算机网络', location: '实验楼 B203' },
]

const heroStates: RealWidgetState[] = [
  {
    id: 'current-morning',
    label: '上课中',
    tone: 'morning',
    title: '9月21日课表',
    dateLine: '星期一 · 第3教学周',
    now: '08:48',
    today: true,
    focus: {
      ...mondayCourses[0],
      kicker: '正在上课',
      countdown: '还剩 52 分钟',
      progress: 0.48,
      current: true,
    },
    following: mondayCourses.slice(1),
  },
  {
    id: 'between',
    label: '课间',
    tone: 'morning',
    title: '9月21日课表',
    dateLine: '星期一 · 第3教学周',
    now: '09:50',
    today: true,
    focus: {
      ...mondayCourses[1],
      kicker: '马上开始',
      countdown: '10 分钟后开始',
      urgency: 'imminent',
    },
    following: mondayCourses.slice(2),
  },
  {
    id: 'current-afternoon',
    label: '下午上课',
    tone: 'day',
    title: '9月21日课表',
    dateLine: '星期一 · 第3教学周',
    now: '14:22',
    today: true,
    focus: {
      ...mondayCourses[2],
      kicker: '正在上课',
      countdown: '还剩 48 分钟',
      progress: 0.52,
      current: true,
    },
    following: mondayCourses.slice(3),
  },
  {
    id: 'ended',
    label: '今日结束',
    tone: 'evening',
    title: '9月21日课表',
    dateLine: '星期一 · 第3教学周',
    now: '18:40',
    today: true,
    stateLabel: '今日课程结束',
    focus: {
      start: '10:00',
      end: '11:40',
      name: '大学英语',
      location: '教学楼 A101',
      kicker: '下一次课程',
      courseDate: '9月22日 · 星期二',
    },
    following: [],
  },
]

const browsingPrevious: RealWidgetState = {
  id: 'browse-previous',
  label: '浏览前一天',
  tone: 'day',
  title: '9月20日课表',
  dateLine: '星期日 · 第2教学周',
  now: '09:50',
  stateLabel: '9月20日无课',
  focus: {
    ...mondayCourses[0],
    kicker: '下一次课程',
    courseDate: '9月21日 · 星期一',
  },
  following: [],
}

const browsingNext: RealWidgetState = {
  id: 'browse-next',
  label: '浏览后一天',
  tone: 'day',
  title: '9月22日课表',
  dateLine: '星期二 · 第3教学周',
  now: '09:50',
  focus: {
    start: '10:00',
    end: '11:40',
    name: '大学英语',
    location: '教学楼 A101',
    kicker: '首节课',
  },
  following: [],
}

const storyStates: RealWidgetState[] = [
  {
    id: 'story-morning',
    label: '早晨',
    tone: 'morning',
    title: '9月21日课表',
    dateLine: '星期一 · 第3教学周',
    now: '07:35',
    today: true,
    focus: {
      ...mondayCourses[0],
      kicker: '下一节课',
      countdown: '25 分钟后开始',
    },
    following: mondayCourses.slice(1, 3),
  },
  heroStates[0],
  heroStates[3],
]

const desktopState: RealWidgetState = {
  id: 'desktop-current',
  label: '真实桌面状态',
  tone: 'day',
  title: '9月25日课表',
  dateLine: '星期五 · 第3教学周',
  now: '15:46',
  today: true,
  focus: {
    start: '15:30',
    end: '17:10',
    name: '计算机网络',
    location: '实验楼 B203',
    kicker: '正在上课',
    countdown: '还剩 84 分钟',
    progress: 0.16,
    current: true,
  },
  following: [],
}

function createButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  return button
}

function focusMarkup(focus: RealFocus): string {
  const classes = [
    'focus-course',
    focus.current ? 'is-current' : '',
    focus.urgency ? `is-${focus.urgency}` : '',
  ].filter(Boolean).join(' ')

  const progress = typeof focus.progress === 'number'
    ? `<div class="course-flow"><div class="course-flow-meta"><span>时间进度</span><span>${Math.round(focus.progress * 100)}%</span></div><div class="course-flow-track" role="progressbar" aria-label="本节课时间进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(focus.progress * 100)}"><span style="--course-progress:${focus.progress}"></span></div></div>`
    : ''

  return `<section class="${classes}"><p class="focus-kicker">${focus.kicker}</p>${focus.courseDate ? `<p class="course-date">${focus.courseDate}</p>` : ''}<h2>${focus.name}</h2><p class="course-time">${focus.start}–${focus.end}</p><p class="course-location">${focus.location}</p>${focus.countdown ? `<p class="countdown">${focus.countdown}</p>` : ''}${progress}</section>`
}

function followingMarkup(courses: RealCourse[], compact: boolean): string {
  const visible = courses.slice(0, compact ? 1 : 3)
  if (!visible.length) return ''
  return `<section class="following" aria-label="后续课程"><p class="section-label">后续课程</p><ol class="timeline">${visible.map((course) => `<li><time>${course.start}</time><span><strong>${course.name}</strong><small>${course.location}</small></span></li>`).join('')}</ol>${courses.length > visible.length ? `<p class="more-courses">还有 ${courses.length - visible.length} 节</p>` : ''}</section>`
}

function widgetMarkup(state: RealWidgetState, options: WidgetMarkupOptions = {}): string {
  const theme = options.theme ?? 'light'
  const scale = options.compact ? 0.84 : 1
  const width = options.compact ? '100%' : '360px'
  const close = options.closeControl ? '<button class="widget-close" type="button" data-real-hide aria-label="隐藏组件" title="隐藏到托盘">×</button>' : ''

  return `<article class="course-widget website-real-widget theme-${theme} tone-${state.tone}${options.compact ? ' is-compact' : ''}" data-real-state="${state.id}" style="--widget-width:${width};--widget-scale:${scale}"><header class="widget-header"><div class="widget-drag-surface"><div class="widget-heading"><div class="title-row"><p class="widget-title">${state.title}</p>${state.today ? '<span class="today-badge">今日</span>' : ''}</div><p class="date-line">${state.dateLine}</p></div><div class="header-right"><div class="header-meta"><time class="now-time">${state.now}</time>${close}</div><nav class="date-nav" aria-label="日期导航"><button type="button" data-real-nav="previous" aria-label="前一天">‹</button><button type="button" data-real-nav="today">今</button><button type="button" data-real-nav="next" aria-label="后一天">›</button></nav></div></div></header>${state.stateLabel ? `<p class="state-label">${state.stateLabel}</p>` : ''}${state.focus ? focusMarkup(state.focus) : ''}${state.emptyMessage ? `<p class="empty-state">${state.emptyMessage}</p>` : ''}${followingMarkup(state.following ?? [], Boolean(options.compact))}</article>`
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
  controls.setAttribute('aria-label', '课刻真实状态演示控制')

  const stepButtons = heroStates.map((state, index) => {
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

  let currentIndex = 0
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

  const bindNavigation = () => {
    host.querySelectorAll<HTMLButtonElement>('[data-real-nav]').forEach((button) => {
      button.addEventListener('click', () => {
        userPaused = true
        const direction = button.dataset.realNav
        if (direction === 'previous') renderState(browsingPrevious, false)
        else if (direction === 'next') renderState(browsingNext, false)
        else renderState(heroStates[currentIndex], false)
        syncTimer()
      })
    })
  }

  const applyState = (state: RealWidgetState) => {
    host.innerHTML = widgetMarkup(state)
    status.textContent = `真实状态演示 · ${state.label}`
    bindNavigation()
    updateControls()
  }

  const renderState = (state: RealWidgetState, immediate = false) => {
    if (transitionId !== undefined) window.clearTimeout(transitionId)
    if (immediate) {
      applyState(state)
      return
    }
    host.classList.add('is-real-transitioning')
    transitionId = window.setTimeout(() => {
      applyState(state)
      host.classList.remove('is-real-transitioning')
      transitionId = undefined
    }, 150)
  }

  const stopTimer = () => {
    if (intervalId !== undefined) window.clearInterval(intervalId)
    intervalId = undefined
  }

  const syncTimer = () => {
    stopTimer()
    updateControls()
    if (isPaused()) return
    intervalId = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % heroStates.length
      renderState(heroStates[currentIndex])
    }, 5000)
  }

  const onStepClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    const index = Number(button.dataset.demoIndex)
    if (Number.isNaN(index)) return
    currentIndex = index
    renderState(heroStates[currentIndex])
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

  renderState(heroStates[currentIndex], true)
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

function setupStoryTimeline(root: HTMLElement): Cleanup {
  const flow = root.querySelector<HTMLElement>('.day-flow')
  const lineIndicator = flow?.querySelector<HTMLElement>('.day-flow__line span')
  const moments = flow ? Array.from(flow.querySelectorAll<HTMLElement>('.day-moment')) : []
  if (!flow || !lineIndicator || moments.length < 3) return () => undefined

  const originals = moments.map((moment) => {
    const visual = moment.querySelector<HTMLElement>('.day-moment__visual')
    return visual ? { visual, html: visual.innerHTML, className: visual.className } : null
  })

  originals.forEach((entry, index) => {
    if (!entry) return
    entry.visual.className = `${entry.className} has-real-widget`
    entry.visual.innerHTML = widgetMarkup(storyStates[index], { compact: true })
  })

  let frame = 0
  const update = () => {
    frame = 0
    const rect = flow.getBoundingClientRect()
    const anchor = window.innerHeight * 0.46
    const start = rect.top + 36
    const end = rect.bottom - 36
    const progress = Math.min(1, Math.max(0, (anchor - start) / Math.max(1, end - start)))
    lineIndicator.style.top = `${progress * 100}%`
    lineIndicator.style.transform = `translateY(${-progress * 100}%)`

    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY
    moments.forEach((moment, index) => {
      const momentRect = moment.getBoundingClientRect()
      const distance = Math.abs(momentRect.top + momentRect.height * 0.42 - anchor)
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
      moment.classList.toggle('is-story-passed', momentRect.top + 36 <= anchor)
    })
    moments.forEach((moment, index) => moment.classList.toggle('is-story-current', index === closestIndex))
  }

  const requestUpdate = () => {
    if (frame) return
    frame = window.requestAnimationFrame(update)
  }

  window.addEventListener('scroll', requestUpdate, { passive: true })
  window.addEventListener('resize', requestUpdate)
  update()

  return () => {
    if (frame) window.cancelAnimationFrame(frame)
    window.removeEventListener('scroll', requestUpdate)
    window.removeEventListener('resize', requestUpdate)
    lineIndicator.removeAttribute('style')
    moments.forEach((moment) => moment.classList.remove('is-story-passed', 'is-story-current'))
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
  visual.removeAttribute('aria-hidden')
  visual.setAttribute('aria-label', '课刻真实窗口关闭到系统托盘并重新打开的交互演示')
  widgetShell.classList.add('focus-desktop__widget--real')
  widgetShell.innerHTML = widgetMarkup(desktopState, { theme: 'dark', closeControl: true })

  desktop.querySelectorAll('.focus-desktop__tray-app, .focus-desktop__demo-hint').forEach((element) => element.remove())
  const iconSource = root.querySelector<HTMLImageElement>('.course-brand img')?.src ?? ''
  const trayButton = createButton('focus-desktop__tray-app', '从系统托盘打开课刻')
  trayButton.innerHTML = iconSource ? `<img src="${iconSource}" alt="" />` : '<span aria-hidden="true"></span>'
  tray.prepend(trayButton)

  const hint = document.createElement('p')
  hint.className = 'focus-desktop__demo-hint'
  hint.textContent = '窗口中的 × 与课刻实际关闭按钮一致'
  desktop.append(hint)

  let visible = true
  let userInteracted = false
  let autoHideId: number | undefined
  let autoShowId: number | undefined
  let observer: IntersectionObserver | undefined

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
      ? '点击真实窗口中的 ×，课刻会隐藏到托盘'
      : '课刻已隐藏 · 点击托盘中的课刻图标重新显示'
  }

  const closeButton = widgetShell.querySelector<HTMLButtonElement>('[data-real-hide]')
  const onClose = () => setVisible(false, true)
  const onTray = () => setVisible(true, true)
  closeButton?.addEventListener('click', onClose)
  trayButton.addEventListener('click', onTray)
  setVisible(true)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduceMotion && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      if (userInteracted || !entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.55)) return
      observer?.disconnect()
      autoHideId = window.setTimeout(() => setVisible(false), 1700)
      autoShowId = window.setTimeout(() => setVisible(true), 3900)
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
  const cleanups = [setupHeroDemo(root), setupStoryTimeline(root), setupTrayDemo(root)]
  return () => cleanups.forEach((cleanup) => cleanup())
}
