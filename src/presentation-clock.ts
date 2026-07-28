export type ReplayConfig = {
  date: string
  start: string
  end: string
  durationSeconds: number
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

export function validateReplayConfig(config: ReplayConfig): void {
  const start = parseClock(config.start)
  const end = parseClock(config.end)
  parseLocalDate(config.date)
  if (end <= start) throw new Error('结束时间必须晚于开始时间')
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds < 3 || config.durationSeconds > 300) {
    throw new Error('演示时长必须在 3–300 秒之间')
  }
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
  private elapsedBeforeOrigin = 0

  start(config: ReplayConfig, timestamp: number): ReplaySnapshot {
    validateReplayConfig(config)
    this.config = { ...config }
    this.active = true
    this.playing = true
    this.originTimestamp = timestamp
    this.elapsedBeforeOrigin = 0
    return this.snapshot(timestamp)
  }

  stop(): void {
    this.active = false
    this.playing = false
    this.config = null
    this.originTimestamp = 0
    this.elapsedBeforeOrigin = 0
  }

  restart(timestamp: number): ReplaySnapshot {
    if (!this.config) throw new Error('演示模式尚未启动')
    this.active = true
    this.playing = true
    this.originTimestamp = timestamp
    this.elapsedBeforeOrigin = 0
    return this.snapshot(timestamp)
  }

  pause(timestamp: number): ReplaySnapshot {
    if (!this.config || !this.active) throw new Error('演示模式尚未启动')
    if (this.playing) this.elapsedBeforeOrigin = this.elapsed(timestamp)
    this.playing = false
    return this.snapshot(timestamp)
  }

  resume(timestamp: number): ReplaySnapshot {
    if (!this.config || !this.active) throw new Error('演示模式尚未启动')
    if (!this.playing) {
      const duration = this.config.durationSeconds * 1_000
      if (!this.config.loop && this.elapsedBeforeOrigin >= duration) this.elapsedBeforeOrigin = 0
      this.originTimestamp = timestamp
      this.playing = true
    }
    return this.snapshot(timestamp)
  }

  toggle(timestamp: number): ReplaySnapshot {
    return this.playing ? this.pause(timestamp) : this.resume(timestamp)
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

    const duration = this.config.durationSeconds * 1_000
    const elapsed = this.elapsed(timestamp)
    const finished = !this.config.loop && elapsed >= duration
    const normalizedElapsed = this.config.loop
      ? elapsed % duration
      : Math.min(elapsed, duration)
    const progress = Math.min(1, Math.max(0, normalizedElapsed / duration))
    const start = parseClock(this.config.start)
    const end = parseClock(this.config.end)
    const simulatedMinute = start + (end - start) * progress
    const date = dateAtMinute(parseLocalDate(this.config.date), simulatedMinute)

    if (finished && this.playing) {
      this.elapsedBeforeOrigin = duration
      this.playing = false
    }

    return { active: true, playing: this.playing, date, progress, finished }
  }

  private elapsed(timestamp: number): number {
    if (!this.playing) return this.elapsedBeforeOrigin
    return Math.max(0, this.elapsedBeforeOrigin + timestamp - this.originTimestamp)
  }
}
