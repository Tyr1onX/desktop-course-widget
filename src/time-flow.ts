export type TemporalTone = 'morning' | 'day' | 'evening' | 'night'
export type UpcomingUrgency = 'calm' | 'soon' | 'imminent'

export interface TimeFlowOptions {
  runtime: 'prototype' | 'live'
  scenario: string
  time: string
  browseDate?: Date
}

export function minutesFromClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function temporalToneForHour(hour: number): TemporalTone {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24
  if (normalized >= 5 && normalized < 10) return 'morning'
  if (normalized >= 10 && normalized < 17) return 'day'
  if (normalized >= 17 && normalized < 22) return 'evening'
  return 'night'
}

export function courseProgress(now: number, start: number, end: number): number | null {
  const duration = end - start
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) return null
  return Math.min(1, Math.max(0, (now - start) / duration))
}

export function upcomingUrgency(minutesUntilStart: number): UpcomingUrgency {
  if (!Number.isFinite(minutesUntilStart) || minutesUntilStart > 30) return 'calm'
  if (minutesUntilStart <= 10) return 'imminent'
  return 'soon'
}

function courseRange(widget: HTMLElement): { start: number; end: number } | null {
  const text = widget.querySelector<HTMLElement>('.focus-course .course-time')?.textContent ?? ''
  const [startText, endText] = text.split(/[–-]/).map((value) => value.trim())
  const start = minutesFromClock(startText)
  const end = minutesFromClock(endText)
  return start === null || end === null ? null : { start, end }
}

function displayedNow(widget: HTMLElement, options: TimeFlowOptions): number | null {
  const value = options.runtime === 'live'
    ? widget.querySelector<HTMLElement>('.now-time')?.textContent ?? ''
    : options.time
  return minutesFromClock(value)
}

function isBrowsing(options: TimeFlowOptions): boolean {
  return options.runtime === 'live' ? Boolean(options.browseDate) : options.scenario === 'browsing'
}

function appendProgress(widget: HTMLElement, progress: number, minutesUntilEnd: number): void {
  const focus = widget.querySelector<HTMLElement>('.focus-course')
  if (!focus) return
  const percent = Math.round(progress * 100)
  const flow = document.createElement('div')
  flow.className = 'course-flow'
  flow.innerHTML = `
    <div class="course-flow-meta"><span>时间进度</span><span>${percent}%</span></div>
    <div class="course-flow-track" role="progressbar" aria-label="本节课时间进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
      <span style="--course-progress:${progress}"></span>
    </div>
  `
  focus.append(flow)
  const countdown = focus.querySelector<HTMLElement>('.countdown')
  if (countdown) countdown.textContent = `还剩 ${Math.max(0, minutesUntilEnd)} 分钟`
}

export function enhanceTimeFlow(widget: HTMLElement, options: TimeFlowOptions): HTMLElement {
  const now = displayedNow(widget, options)
  if (now === null) return widget

  widget.classList.add(`tone-${temporalToneForHour(Math.floor(now / 60))}`)
  if (isBrowsing(options)) {
    widget.classList.add('is-date-browsing')
    return widget
  }

  const focus = widget.querySelector<HTMLElement>('.focus-course')
  const range = courseRange(widget)
  if (!focus || !range) return widget

  if (focus.classList.contains('is-current')) {
    const progress = courseProgress(now, range.start, range.end)
    if (progress === null) return widget
    focus.classList.add('has-time-flow')
    appendProgress(widget, progress, range.end - now)
    return widget
  }

  const kicker = focus.querySelector<HTMLElement>('.focus-kicker')
  if (kicker?.textContent !== '下一节课') return widget
  const minutesUntilStart = Math.max(0, range.start - now)
  const urgency = upcomingUrgency(minutesUntilStart)
  focus.classList.add(`is-${urgency}`)
  if (urgency === 'soon') kicker.textContent = '即将开始'
  if (urgency === 'imminent') kicker.textContent = '马上开始'
  return widget
}
