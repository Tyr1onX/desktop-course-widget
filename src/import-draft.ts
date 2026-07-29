export type ImportSource = 'excel' | 'image'

export type ImportReviewStatus = 'confirmed' | 'review' | 'missing'

export type ImportFieldKey =
  | 'name'
  | 'teacher'
  | 'weekday'
  | 'startSection'
  | 'endSection'
  | 'weeks'
  | 'parity'
  | 'location'

export type NormalizedImageBox = {
  x: number
  y: number
  width: number
  height: number
}

export type ImportFieldEvidence = {
  field: ImportFieldKey
  status: ImportReviewStatus
  confidence?: number
  rawText?: string
  box?: NormalizedImageBox
  reason?: string
}

export type ImportCourseReview = {
  sourceBox?: NormalizedImageBox
  fields?: ImportFieldEvidence[]
}

export type ImportImageSource = {
  width: number
  height: number
  weekdayColumns?: number
  sectionRows?: number
  recognizerVersion?: string
}

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
  review?: ImportCourseReview
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
  imageSource?: ImportImageSource
}

export type ImportIssueSeverity = 'error' | 'warning' | 'review'

export type ImportIssue = {
  severity: ImportIssueSeverity
  code: string
  message: string
  courseIndex?: number
  field?: ImportFieldKey
  relatedCourseIndexes?: number[]
}
