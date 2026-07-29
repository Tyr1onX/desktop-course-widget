export type CourseHandoffPhase =
  | 'start'
  | 'outgoing-complete'
  | 'shared-source-matched'
  | 'shared-text-moving'
  | 'ownership-transferred'
  | 'content-installed'
  | 'resizing'
  | 'complete'
  | 'cancelled'
  | 'reduced-motion'
  | 'stable-sync'
  | 'failed'

export type CourseHandoffStatus = 'completed' | 'cancelled' | 'reduced-motion' | 'stable' | 'failed'
export type CourseHandoffSettleTarget = 'current' | 'target'

export interface CourseHandoffResult {
  status: CourseHandoffStatus
  sharedCourse: boolean
  error?: unknown
}

export interface CourseHandoffHandle {
  finished: Promise<CourseHandoffResult>
  cancel: (settleTo?: CourseHandoffSettleTarget) => void
}

export interface CourseHandoffTimings {
  exit: number
  exitGap: number
  sharedMove: number
  shellReveal: number
  finalWipe: number
  finalReveal: number
  textHandoff: number
  resize: number
  normalEnter: number
}

export interface TransitionCourseOptions {
  host: HTMLElement
  currentWidget: HTMLElement
  nextWidget: HTMLElement
  durationScale?: number
  reducedMotion?: boolean
  timings?: Partial<CourseHandoffTimings>
  onPhase?: (phase: CourseHandoffPhase) => void
}

export const COURSE_HANDOFF_DEFAULT_TIMINGS: Readonly<CourseHandoffTimings> = Object.freeze({
  exit: 640,
  exitGap: 70,
  sharedMove: 2100,
  shellReveal: 900,
  finalWipe: 760,
  finalReveal: 420,
  textHandoff: 420,
  resize: 1150,
  normalEnter: 1500,
})
