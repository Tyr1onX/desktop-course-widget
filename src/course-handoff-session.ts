import {
  cleanupTransient,
  clearElementAnimations,
  findSharedCourseSource,
  resetHandoffBody,
  syncNode,
  syncWeekMeta,
  syncWeekMetaNode,
  transitionPrimary,
  transitionSecondary,
} from './course-handoff-dom'
import { runSharedCourseHandoff } from './course-handoff-shared'
import {
  COURSE_HANDOFF_DEFAULT_TIMINGS,
  type CourseHandoffHandle,
  type CourseHandoffPhase,
  type CourseHandoffResult,
  type CourseHandoffSettleTarget,
  type CourseHandoffTimings,
  type TransitionCourseOptions,
} from './course-handoff-types'

function emitPhase(host: HTMLElement, phase: CourseHandoffPhase, callback?: (phase: CourseHandoffPhase) => void) {
  callback?.(phase)
  host.dispatchEvent(new CustomEvent('course-handoff:phase', { detail: { phase } }))
}

function transitionPrimaryParts(root: ParentNode | null) {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(
    ':scope > .focus-course, :scope > .state-label, :scope > .empty-state, :scope > .opening-date',
  ))
}

function directWeekMeta(widget: HTMLElement) {
  return widget.querySelector<HTMLElement>(':scope > .widget-week-meta')
}

function outerBlockHeight(element: HTMLElement) {
  const style = getComputedStyle(element)
  const marginTop = Number.parseFloat(style.marginTop) || 0
  const marginBottom = Number.parseFloat(style.marginBottom) || 0
  return element.getBoundingClientRect().height + marginTop + marginBottom
}

function measureDetachedWeekMeta(widget: HTMLElement, template: HTMLElement | null) {
  if (!template) return 0
  if (template.isConnected) return outerBlockHeight(template)
  const probe = template.cloneNode(true) as HTMLElement
  probe.style.visibility = 'hidden'
  probe.setAttribute('aria-hidden', 'true')
  widget.append(probe)
  const height = outerBlockHeight(probe)
  probe.remove()
  return height
}

export class CourseHandoffSession implements CourseHandoffHandle {
  readonly finished: Promise<CourseHandoffResult>

  private readonly host: HTMLElement
  private readonly currentWidget: HTMLElement
  private readonly nextWidget: HTMLElement
  private readonly durationScale: number
  private readonly timings: CourseHandoffTimings
  private readonly onPhase?: (phase: CourseHandoffPhase) => void
  private readonly animations = new Set<Animation>()
  private readonly delays = new Map<number, () => void>()
  private readonly resolveFinished: (result: CourseHandoffResult) => void
  private readonly currentWeekMetaSnapshot: HTMLElement | null

  private active = true
  private resolved = false
  private sharedCourse = false
  private stage: HTMLElement | null = null
  private bodyMoved = false
  private contentInstalled = false

  constructor(options: TransitionCourseOptions) {
    this.host = options.host
    this.currentWidget = options.currentWidget
    this.nextWidget = options.nextWidget
    this.durationScale = Number.isFinite(options.durationScale) ? Math.max(0, options.durationScale ?? 1) : 1
    this.timings = { ...COURSE_HANDOFF_DEFAULT_TIMINGS, ...options.timings }
    this.onPhase = options.onPhase
    this.currentWeekMetaSnapshot = directWeekMeta(this.currentWidget)?.cloneNode(true) as HTMLElement | null
    let resolver!: (result: CourseHandoffResult) => void
    this.finished = new Promise<CourseHandoffResult>((resolve) => { resolver = resolve })
    this.resolveFinished = resolver
  }

  start() {
    this.host.classList.add('is-course-handoff-active')
    this.host.style.setProperty('--course-handoff-following-duration', `${this.scaled(280)}ms`)
    this.phase('start')
    void this.run()
      .then(() => {
        if (this.active) this.finish({ status: 'completed', sharedCourse: this.sharedCourse }, 'complete')
      })
      .catch((error: unknown) => {
        if (!this.active) return
        this.active = false
        this.cancelWork()
        this.settle('target')
        this.finish({ status: 'failed', sharedCourse: this.sharedCourse, error }, 'failed')
      })
    return this
  }

  cancel = (settleTo: CourseHandoffSettleTarget = 'target') => {
    if (!this.active || this.resolved) return
    this.active = false
    this.cancelWork()
    this.settle(settleTo)
    this.finish({ status: 'cancelled', sharedCourse: this.sharedCourse }, 'cancelled')
  }

  private scaled(milliseconds: number) {
    return milliseconds * this.durationScale
  }

  private phase = (phase: CourseHandoffPhase) => {
    emitPhase(this.host, phase, this.onPhase)
  }

  private finish(result: CourseHandoffResult, phase: CourseHandoffPhase) {
    if (this.resolved) return
    this.resolved = true
    this.active = false
    this.cancelWork()
    cleanupTransient(this.host)
    this.host.classList.remove('is-course-handoff-active')
    this.host.style.removeProperty('--course-handoff-following-duration')
    this.phase(phase)
    this.resolveFinished(result)
  }

  private isActive = () => this.active && !this.resolved

  private rememberAnimation(animation: Animation) {
    animation.id = 'course-handoff'
    this.animations.add(animation)
    void animation.finished.finally(() => this.animations.delete(animation)).catch(() => undefined)
    return animation.finished.catch(() => undefined)
  }

  private animate = (
    element: HTMLElement | null,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    if (!element || !this.isActive() || typeof element.animate !== 'function') return Promise.resolve()
    return this.rememberAnimation(element.animate(keyframes, {
      ...options,
      duration: typeof options.duration === 'number' ? this.scaled(options.duration) : options.duration,
      delay: typeof options.delay === 'number' ? this.scaled(options.delay) : options.delay,
    }))
  }

  private nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

  private delay = (milliseconds: number) => new Promise<void>((resolve) => {
    if (!this.isActive() || milliseconds <= 0) {
      resolve()
      return
    }
    const timeout = window.setTimeout(() => {
      this.delays.delete(timeout)
      resolve()
    }, this.scaled(milliseconds))
    this.delays.set(timeout, resolve)
  })

  private cancelWork() {
    this.animations.forEach((animation) => animation.cancel())
    this.animations.clear()
    this.delays.forEach((resolve, timeout) => {
      window.clearTimeout(timeout)
      resolve()
    })
    this.delays.clear()
  }

  private syncHeader() {
    const currentHeader = this.currentWidget.querySelector<HTMLElement>('.widget-header')
    const nextHeader = this.nextWidget.querySelector<HTMLElement>('.widget-header')
    if (currentHeader && nextHeader) syncNode(currentHeader, nextHeader)
  }

  private settle(settleTo: CourseHandoffSettleTarget) {
    const stage = this.stage?.isConnected ? this.stage : this.host.querySelector<HTMLElement>('.widget-body-handoff')
    if (stage) {
      const target = stage.querySelector<HTMLElement>('.widget-body.is-handoff-target')
      const current = stage.querySelector<HTMLElement>('.widget-body.is-handoff-current')
      const keeper = settleTo === 'target' ? target ?? current : current ?? target
      stage.querySelectorAll<HTMLElement>('.course-shared-morph, .course-shared-float, .course-transition-overlay').forEach((item) => item.remove())
      if (keeper) {
        if (keeper === target) {
          this.syncHeader()
          syncWeekMeta(this.currentWidget, this.nextWidget)
        } else {
          syncWeekMetaNode(this.currentWidget, this.currentWeekMetaSnapshot)
        }
        resetHandoffBody(keeper)
        stage.replaceWith(keeper)
      } else {
        stage.remove()
      }
      this.stage = null
      this.contentInstalled = keeper === target
    } else if (settleTo === 'target' && !this.bodyMoved && !this.contentInstalled) {
      this.host.replaceChildren(this.nextWidget)
      this.contentInstalled = true
    }
    cleanupTransient(this.host)
  }

  private async run() {
    const currentBody = this.currentWidget.querySelector<HTMLElement>('.widget-body')
    const nextBody = this.nextWidget.querySelector<HTMLElement>('.widget-body')
    if (!currentBody || !nextBody) {
      this.host.replaceChildren(this.nextWidget)
      this.contentInstalled = true
      return
    }

    const currentWeekMeta = directWeekMeta(this.currentWidget)
    const nextWeekMeta = directWeekMeta(this.nextWidget)
    const currentWeekMetaHeight = measureDetachedWeekMeta(this.currentWidget, currentWeekMeta)
    const nextWeekMetaHeight = measureDetachedWeekMeta(this.currentWidget, nextWeekMeta)
    const removesWeekMeta = Boolean(currentWeekMeta) && !nextWeekMeta
    const addsWeekMeta = !currentWeekMeta && Boolean(nextWeekMeta)

    const currentHeight = currentBody.getBoundingClientRect().height
    const stage = document.createElement('div')
    stage.className = 'widget-body-handoff'
    stage.style.height = `${currentHeight}px`
    currentBody.classList.add('is-handoff-current')
    nextBody.classList.add('is-handoff-target')
    currentBody.replaceWith(stage)
    stage.append(currentBody, nextBody)
    this.stage = stage
    this.bodyMoved = true

    await this.nextFrame()
    if (!this.isActive()) return

    const targetHeight = nextBody.getBoundingClientRect().height
    const outgoingPrimary = transitionPrimary(currentBody)
    const outgoingSecondary = transitionSecondary(currentBody)
    const targetPrimary = nextBody.querySelector<HTMLElement>('.focus-course') ?? transitionPrimary(nextBody)
    const sharedSource = findSharedCourseSource(currentBody, nextBody)
    let sharedHandoffCompleted = false

    if (sharedSource && targetPrimary?.classList.contains('focus-course')) {
      this.sharedCourse = true
      sharedHandoffCompleted = await runSharedCourseHandoff({
        timings: this.timings,
        animate: this.animate,
        delay: this.delay,
        nextFrame: this.nextFrame,
        active: this.isActive,
        phase: this.phase,
      }, stage, sharedSource, outgoingPrimary, targetPrimary)
      if (!this.isActive()) return
    } else {
      await Promise.all([
        ...transitionPrimaryParts(currentBody).map((part) => this.animate(part, [
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
          { opacity: 0, transform: 'translateY(-46px) scale(.97)', filter: 'blur(5px)' },
        ], { duration: this.timings.exit, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' })),
        this.animate(outgoingSecondary, [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-16px)' },
        ], { duration: this.timings.exit - 180, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' }),
      ])
      if (!this.isActive()) return
      this.phase('outgoing-complete')
    }

    this.syncHeader()
    const nextFollowing = transitionSecondary(nextBody)
    if (sharedHandoffCompleted && nextFollowing) {
      nextFollowing.style.opacity = '0'
      nextFollowing.style.transform = 'translateY(10px)'
    }

    resetHandoffBody(nextBody)
    stage.replaceChildren(nextBody)
    stage.classList.add('is-size-settling')

    let resizeStartHeight = currentHeight
    let resizeTargetHeight = targetHeight
    if (removesWeekMeta) {
      resizeStartHeight += currentWeekMetaHeight
      stage.style.height = `${resizeStartHeight}px`
      syncWeekMeta(this.currentWidget, this.nextWidget)
    }
    if (addsWeekMeta) resizeTargetHeight += nextWeekMetaHeight

    this.contentInstalled = true
    this.phase('content-installed')

    const resizeAnimation = this.animate(stage, [
      { height: `${resizeStartHeight}px` },
      { height: `${resizeTargetHeight}px` },
    ], { duration: this.timings.resize, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' })
    this.phase('resizing')

    const enteringPrimary = sharedHandoffCompleted ? [] : transitionPrimaryParts(nextBody)
    await Promise.all([
      resizeAnimation,
      ...enteringPrimary.map((part) => this.animate(part, [
        { opacity: 0, transform: 'translateY(34px) scale(.96)', filter: 'blur(5px)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
      ], { duration: this.timings.normalEnter, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' })),
      this.animate(nextFollowing, [
        { opacity: 0, transform: `translateY(${sharedHandoffCompleted ? 10 : 14}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], {
        duration: sharedHandoffCompleted ? 560 : 720,
        delay: sharedHandoffCompleted ? 80 : 140,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      }),
    ])
    if (!this.isActive()) return
    if (nextFollowing) {
      clearElementAnimations(nextFollowing)
      nextFollowing.style.removeProperty('opacity')
      nextFollowing.style.removeProperty('transform')
    }
    enteringPrimary.forEach((part) => clearElementAnimations(part))

    stage.style.height = `${resizeTargetHeight}px`
    clearElementAnimations(stage)
    syncWeekMeta(this.currentWidget, this.nextWidget)
    stage.replaceWith(nextBody)
    this.stage = null
    resetHandoffBody(nextBody)
  }
}
