export type ReplayConfig = {
  date: string
  start: string
  end: string
  minutesPerSecond: number
  loop: boolean
}

export type ReplaySnapshot = {
  active: boolean
  playing: boolean
  date: Date
  progress: number
  finished: boolean
}

const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function parseClock(value: string): number {
  if (!clockPattern.test(value)) throw new Error('演示时间格式无效')
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function parseLocalDate(value: string): Date {
  if (!datePattern.test(value)) throw new Error('演示日期格式无效')
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(year, month - 1, day)
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new Error('演示日期无效')
  }
  return result
}

function validateSpeed(minutesPerSecond: number): void {
  if (!Number.isFinite(minutesPerSecond) || minutesPerSecond < 1 || minutesPerSecond > 5) {
    throw new Error('时间流速必须在 1–5 分钟/秒之间')
  }
}

export function validateReplayConfig(config: ReplayConfig): void {
  const start = parseClock(config.start)
  const end = parseClock(config.end)
  parseLocalDate(config.date)
  if (end <= start) throw new Error('结束时间必须晚于开始时间')
  validateSpeed(config.minutesPerSecond)
}

function dateAtMinute(base: Date, minute: number): Date {
  const result = new Date(base)
  result.setHours(0, 0, 0, 0)
  result.setMinutes(minute)
  return result
}

export class PresentationClock {
  private config: ReplayConfig | null = null
  private active = false
  private playing = false
  private originTimestamp = 0
  private simulatedMinutesBeforeOrigin = 0

  start(config: ReplayConfig, timestamp: number): ReplaySnapshot {
    validateReplayConfig(config)
    this.config = { ...config }
    this.active = true
    this.playing = true
    this.originTimestamp = timestamp
    this.simulatedMinutesBeforeOrigin = 0
    return this.snapshot(timestamp)
  }

  stop(): void {
    this.active = false
    this.playing = false
    this.config = null
    this.originTimestamp = 0
    this.simulatedMinutesBeforeOrigin = 0
  }

  restart(timestamp: number): ReplaySnapshot {
    if (!this.config) throw new Error('演示模式尚未启动')
    this.active = true
    this.playing = true
    this.originTimestamp = timestamp
    this.simulatedMinutesBeforeOrigin = 0
    return this.snapshot(timestamp)
  }

  pause(timestamp: number): ReplaySnapshot {
    if (!this.config || !this.active) throw new Error('演示模式尚未启动')
    if (this.playing) this.simulatedMinutesBeforeOrigin = this.simulatedElapsed(timestamp)
    this.playing = false
    return this.snapshot(timestamp)
  }

  resume(timestamp: number): ReplaySnapshot {
    if (!this.config || !this.active) throw new Error('演示模式尚未启动')
    if (!this.playing) {
      const span = parseClock(this.config.end) - parseClock(this.config.start)
      if (!this.config.loop && this.simulatedMinutesBeforeOrigin >= span) this.simulatedMinutesBeforeOrigin = 0
      this.originTimestamp = timestamp
      this.playing = true
    }
    return this.snapshot(timestamp)
  }

  toggle(timestamp: number): ReplaySnapshot {
    return this.playing ? this.pause(timestamp) : this.resume(timestamp)
  }

  setSpeed(minutesPerSecond: number, timestamp: number): ReplaySnapshot {
    if (!this.config || !this.active) throw new Error('演示模式尚未启动')
    validateSpeed(minutesPerSecond)
    if (this.playing) this.simulatedMinutesBeforeOrigin = this.simulatedElapsed(timestamp)
    this.config.minutesPerSecond = minutesPerSecond
    this.originTimestamp = timestamp
    return this.snapshot(timestamp)
  }

  isActive(): boolean {
    return this.active
  }

  isPlaying(): boolean {
    return this.playing
  }

  currentConfig(): ReplayConfig | null {
    return this.config ? { ...this.config } : null
  }

  snapshot(timestamp: number): ReplaySnapshot {
    if (!this.config || !this.active) {
      return { active: false, playing: false, date: new Date(), progress: 0, finished: false }
    }

    const start = parseClock(this.config.start)
    const end = parseClock(this.config.end)
    const span = end - start
    const elapsed = this.simulatedElapsed(timestamp)
    const finished = !this.config.loop && elapsed >= span
    const normalizedElapsed = this.config.loop
      ? elapsed % span
      : Math.min(elapsed, span)
    const progress = Math.min(1, Math.max(0, normalizedElapsed / span))
    const date = dateAtMinute(parseLocalDate(this.config.date), start + normalizedElapsed)

    if (finished && this.playing) {
      this.simulatedMinutesBeforeOrigin = span
      this.playing = false
    }

    return { active: true, playing: this.playing, date, progress, finished }
  }

  private simulatedElapsed(timestamp: number): number {
    if (!this.config || !this.playing) return this.simulatedMinutesBeforeOrigin
    const realSeconds = Math.max(0, timestamp - this.originTimestamp) / 1_000
    return this.simulatedMinutesBeforeOrigin + realSeconds * this.config.minutesPerSecond
  }
}
