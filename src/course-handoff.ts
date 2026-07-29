import { courseIdentityKey, findSharedCourseSource, syncNode, syncStableWidget } from './course-handoff-dom'
import { CourseHandoffSession } from './course-handoff-session'
import type { CourseHandoffHandle, CourseHandoffResult, TransitionCourseOptions } from './course-handoff-types'

export { courseIdentityKey, findSharedCourseSource, syncNode, syncStableWidget }
export { COURSE_HANDOFF_DEFAULT_TIMINGS } from './course-handoff-types'
export type {
  CourseHandoffHandle,
  CourseHandoffPhase,
  CourseHandoffResult,
  CourseHandoffSettleTarget,
  CourseHandoffStatus,
  CourseHandoffTimings,
  TransitionCourseOptions,
} from './course-handoff-types'

const activeSessions = new WeakMap<HTMLElement, CourseHandoffSession>()

function emitPhase(options: TransitionCourseOptions, phase: 'reduced-motion' | 'stable-sync') {
  options.onPhase?.(phase)
  options.host.dispatchEvent(new CustomEvent('course-handoff:phase', { detail: { phase } }))
}

function resolvedHandle(result: CourseHandoffResult): CourseHandoffHandle {
  return { finished: Promise.resolve(result), cancel: () => undefined }
}

export function transitionCourse(options: TransitionCourseOptions): CourseHandoffHandle {
  const { host, currentWidget, nextWidget } = options
  activeSessions.get(host)?.cancel('target')
  const reducedMotion = options.reducedMotion
    ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion || (options.durationScale ?? 1) <= 0) {
    host.replaceChildren(nextWidget)
    emitPhase(options, 'reduced-motion')
    return resolvedHandle({ status: 'reduced-motion', sharedCourse: false })
  }

  if (courseIdentityKey(currentWidget) === courseIdentityKey(nextWidget)) {
    syncStableWidget(currentWidget, nextWidget)
    emitPhase(options, 'stable-sync')
    return resolvedHandle({ status: 'stable', sharedCourse: false })
  }

  const session = new CourseHandoffSession(options).start()
  activeSessions.set(host, session)
  void session.finished.finally(() => {
    if (activeSessions.get(host) === session) activeSessions.delete(host)
  })
  return session
}
