export type ScreenshotImportLessonTime = {
  section: number
}

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const ansiEscapePattern = /\u001B\[[0-?]*[ -/]*[@-~]/g
const controlCharacterPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const diagnosticMarkerPattern = /\[OCR-DIAG:(OCR-[A-Z0-9-]+)\]/i
const developmentDetailPattern = /\s*DEV_OCR_DETAIL:(.*)$/s

const directUserMessages = new Set([
  '请填写课表名称',
  '请选择星期一作为第一周开始日期',
  '仍有课程字段需要修正或确认',
  '已取消截图识别。',
])

const noCourseHints = [
  '未形成课程记录',
  '未从文字与坐标中形成课程记录',
  '未可靠找到星期表头',
  'recognizer returned no courses',
  'no course record',
]

const runtimeHints = [
  'paddleocr is not installed',
  'paddleocr initialization failed',
  'ocr 运行环境缺失',
  'ocr runtime',
  'runtime probe',
  'native-dll-load',
]

const invalidImageHints = [
  'invalid image',
  'cannot identify image',
  '无法读取图片',
  '不支持的图片',
]

const technicalHints = [
  'warnings.warn',
  'creating model',
  'model files already exist',
  'screenshot-import failed',
  'traceback',
  '.paddlex',
  '.paddleocr',
  'python.exe',
  'spawn failed',
]

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

export function screenshotImportDiagnosticId(error: unknown): string | null {
  const raw = readErrorMessage(error, new Set<object>())
  return diagnosticMarkerPattern.exec(raw)?.[1]?.toUpperCase() ?? null
}

export function screenshotImportErrorText(error: unknown): string {
  const raw = readErrorMessage(error, new Set<object>())
  const diagnosticId = diagnosticMarkerPattern.exec(raw)?.[1]?.toUpperCase() ?? null
  const developmentDetail = developmentDetailPattern.exec(raw)?.[1]?.trim() ?? ''
  const resolved = sanitizeErrorMessage(
    raw
      .replace(diagnosticMarkerPattern, '')
      .replace(developmentDetailPattern, ''),
  )
  if (!resolved) return withDiagnostic('操作失败，请稍后重试。', diagnosticId)

  let message: string
  if (directUserMessages.has(resolved)) {
    message = resolved
  } else {
    const normalized = resolved.toLocaleLowerCase()
    if (noCourseHints.some((hint) => normalized.includes(hint))) {
      message = '未能从这张图片中识别出课表。请使用包含星期标题、节次和全部课程的完整截图后重试。'
    } else if (
      normalized.includes('timeout')
      || normalized.includes('timed out')
      || normalized.includes('超时')
    ) {
      message = '课表截图识别超时，请尝试使用更清晰或尺寸更小的图片。'
    } else if (runtimeHints.some((hint) => normalized.includes(hint))) {
      message = '本地截图识别运行时检查失败。'
    } else if (invalidImageHints.some((hint) => normalized.includes(hint))) {
      message = '无法读取这张图片，请选择有效的 PNG、JPG 或 JPEG 文件。'
    } else if (looksTechnical(resolved, normalized) || resolved.length > 180) {
      message = '课表截图识别失败。'
    } else {
      message = resolved
    }
  }

  const visible = withDiagnostic(message, diagnosticId)
  return developmentDetail
    ? `${visible}\n开发诊断：${sanitizeErrorMessage(developmentDetail)}`
    : visible
}

function withDiagnostic(message: string, diagnosticId: string | null): string {
  return diagnosticId ? `${message} 诊断编号：${diagnosticId}` : message
}

function sanitizeErrorMessage(value: string): string {
  return value
    .replace(ansiEscapePattern, '')
    .replace(controlCharacterPattern, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksTechnical(value: string, normalized: string): boolean {
  return technicalHints.some((hint) => normalized.includes(hint))
    || /[a-z]:\\/i.test(value)
    || /\/(?:users|home)\//i.test(value)
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
