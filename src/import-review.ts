import type { ImportCourse, ImportDraft, ImportDraftSummary } from './import-draft'

export function summarizeImportCourses(courses: ImportCourse[]): ImportDraftSummary {
  return {
    arrangements: courses.length,
    highestWeek: courses.reduce((highest, course) => Math.max(highest, ...course.weeks), 0),
    locationCount: courses.filter((course) => Boolean(course.location?.trim())).length,
  }
}

export function weeksToText(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((left, right) => left - right)
  if (sorted.length === 0) return ''

  const segments: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (const week of sorted.slice(1)) {
    if (week === end + 1) {
      end = week
      continue
    }
    segments.push(start === end ? String(start) : `${start}-${end}`)
    start = week
    end = week
  }
  segments.push(start === end ? String(start) : `${start}-${end}`)
  return segments.join(', ')
}

export function parseWeeksText(value: string): number[] {
  const normalized = value
    .trim()
    .replaceAll('，', ',')
    .replaceAll('、', ',')
    .replaceAll('；', ',')
    .replaceAll(';', ',')
    .replaceAll('周', '')

  if (!normalized) throw new Error('教学周不能为空')

  const weeks = new Set<number>()
  for (const rawSegment of normalized.split(',')) {
    const segment = rawSegment.trim()
    if (!segment) continue
    const range = segment.match(/^(\d{1,2})\s*[-~～至]\s*(\d{1,2})$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start < 1 || end > 30 || start > end) throw new Error(`教学周范围“${segment}”无效`)
      for (let week = start; week <= end; week += 1) weeks.add(week)
      continue
    }

    if (!/^\d{1,2}$/.test(segment)) throw new Error(`无法识别教学周“${segment}”`)
    const week = Number(segment)
    if (week < 1 || week > 30) throw new Error(`教学周 ${week} 超出 1～30 周`)
    weeks.add(week)
  }

  if (weeks.size === 0) throw new Error('教学周不能为空')
  return [...weeks].sort((left, right) => left - right)
}

export function validateImportCourse(course: ImportCourse, lessonCount: number): string[] {
  const issues: string[] = []
  if (!course.name.trim()) issues.push('课程名称不能为空')
  if (!Number.isInteger(course.weekday) || course.weekday < 1 || course.weekday > 7) issues.push('星期无效')
  if (!Number.isInteger(course.startSection) || course.startSection < 1 || course.startSection > lessonCount) {
    issues.push('开始节次无效')
  }
  if (!Number.isInteger(course.endSection) || course.endSection < course.startSection || course.endSection > lessonCount) {
    issues.push('结束节次无效')
  }
  if (course.weeks.length === 0 || course.weeks.some((week) => !Number.isInteger(week) || week < 1 || week > 30)) {
    issues.push('教学周无效')
  }
  if (!['all', 'odd', 'even'].includes(course.parity)) issues.push('单双周设置无效')
  return issues
}

export function validateImportDraft(draft: ImportDraft, lessonCount: number): string[] {
  if (draft.courses.length === 0) return ['没有可导入的课程安排']
  return draft.courses.flatMap((course, index) =>
    validateImportCourse(course, lessonCount).map((issue) => `第 ${index + 1} 项“${course.name.trim() || '未命名课程'}”：${issue}`),
  )
}

export function refreshImportDraftSummary(draft: ImportDraft): void {
  draft.summary = summarizeImportCourses(draft.courses)
}
