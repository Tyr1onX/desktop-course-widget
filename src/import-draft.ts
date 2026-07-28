export type ImportSource = 'excel' | 'image'

export type ImportCourse = {
  code?: string | null
  name: string
  teacher?: string | null
  weekday: number
  startSection: number
  endSection: number
  weeks: number[]
  parity: 'all' | 'odd' | 'even'
  location?: string | null
}

export type ImportDraftSummary = {
  arrangements: number
  highestWeek: number
  locationCount: number
}

export type ImportDraft = {
  schemaVersion: number
  source: ImportSource
  sourceName: string
  suggestedName: string
  detectedTermText?: string | null
  summary: ImportDraftSummary
  warnings: string[]
  courses: ImportCourse[]
}
