export type ScreenshotImportLessonTime = {
  section: number
}

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/

export function screenshotImportLessonCount(times: ScreenshotImportLessonTime[]): number {
  const sections = times
    .map((time) => time.section)
    .filter((section) => Number.isInteger(section) && section > 0)
  return sections.length ? Math.max(...sections) : 1
}

export function isFirstWeekMonday(value: string): boolean {
  const match = isoDatePattern.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCDay() === 1
}

export function screenshotImportErrorText(error: unknown): string {
  const resolved = readErrorMessage(error, new Set<object>())
  return resolved || '操作失败，请稍后重试。'
}

function readErrorMessage(error: unknown, visited: Set<object>): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  if (!error || typeof error !== 'object' || visited.has(error)) return ''

  visited.add(error)
  const record = error as Record<string, unknown>
  for (const key of ['message', 'error', 'detail', 'data']) {
    const message = readErrorMessage(record[key], visited)
    if (message) return message
  }
  return ''
}
