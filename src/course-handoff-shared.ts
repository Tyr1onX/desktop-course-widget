import { clearElementAnimations } from './course-handoff-dom'
import type { CourseHandoffPhase, CourseHandoffTimings } from './course-handoff-types'

type SharedTextMotion = {
  element: HTMLElement
  keyframes: Keyframe[]
}

export interface SharedHandoffRuntime {
  timings: CourseHandoffTimings
  animate: (element: HTMLElement | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) => Promise<unknown>
  delay: (milliseconds: number) => Promise<void>
  nextFrame: () => Promise<void>
  active: () => boolean
  phase: (phase: CourseHandoffPhase) => void
}

function createOverlay(stage: HTMLElement) {
  stage.querySelector<HTMLElement>('.course-transition-overlay')?.remove()
  const overlay = document.createElement('div')
  overlay.className = 'course-transition-overlay'
  stage.append(overlay)
  return overlay
}

function sharedTextMotion(
  source: HTMLElement | null,
  target: HTMLElement | null,
  overlay: HTMLElement,
): SharedTextMotion | null {
  if (!source || !target) return null
  const sourceRect = source.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const overlayRect = overlay.getBoundingClientRect()
  const sourceStyle = getComputedStyle(source)
  const targetStyle = getComputedStyle(target)
  const sourceSize = Number.parseFloat(sourceStyle.fontSize) || 1
  const targetSize = Number.parseFloat(targetStyle.fontSize) || sourceSize
  const scale = targetSize / sourceSize
  const deltaX = targetRect.left - sourceRect.left
  const deltaY = targetRect.top - sourceRect.top
  const floating = source.cloneNode(true) as HTMLElement
  floating.removeAttribute('id')
  floating.classList.add('course-shared-float')
  Object.assign(floating.style, {
    left: `${sourceRect.left - overlayRect.left}px`,
    top: `${sourceRect.top - overlayRect.top}px`,
    color: sourceStyle.color,
    fontFamily: sourceStyle.fontFamily,
    fontSize: sourceStyle.fontSize,
    fontStyle: sourceStyle.fontStyle,
    fontWeight: sourceStyle.fontWeight,
    lineHeight: sourceStyle.lineHeight,
    letterSpacing: sourceStyle.letterSpacing,
  })
  source.dataset.sharedSourceHidden = 'true'
  source.style.visibility = 'hidden'
  overlay.append(floating)
  return {
    element: floating,
    keyframes: [
      { opacity: 1, color: sourceStyle.color, transform: 'translate3d(0, 0, 0) scale(1)' },
      { offset: .22, opacity: 1, color: sourceStyle.color, transform: `translate3d(${deltaX * .12}px, ${deltaY * .12}px, 0) scale(${1 + (scale - 1) * .14})` },
      { offset: .52, opacity: 1, color: targetStyle.color, transform: `translate3d(${deltaX * .5}px, ${deltaY * .5}px, 0) scale(${1 + (scale - 1) * .52})` },
      {
        offset: .82,
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX * .86}px, ${deltaY * .86}px, 0) scale(${1 + (scale - 1) * .87})`,
      },
      {
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`,
      },
    ] satisfies Keyframe[],
  }
}

function transferSharedTextOwnership(
  motions: SharedTextMotion[],
  targetCopies: HTMLElement[],
  phase: (phase: CourseHandoffPhase) => void,
) {
  motions.forEach((motion) => {
    clearElementAnimations(motion.element)
    motion.element.style.visibility = 'hidden'
  })
  targetCopies.forEach((copy) => {
    copy.classList.remove('is-shared-copy-hidden')
    copy.style.removeProperty('opacity')
  })
  phase('ownership-transferred')
}

export async function runSharedCourseHandoff(
  runtime: SharedHandoffRuntime,
  stage: HTMLElement,
  sharedSource: HTMLElement,
  outgoingPrimary: HTMLElement | null,
  targetPrimary: HTMLElement,
) {
  const { animate, timings } = runtime
  runtime.phase('shared-source-matched')
  sharedSource.closest<HTMLElement>('.following')?.classList.add('is-promoting-course')
  sharedSource.classList.add('is-promoting-source')

  await animate(outgoingPrimary, [
    { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
    { offset: .48, opacity: .84, transform: 'translateY(-13px) scale(.993)', filter: 'blur(.8px)' },
    { opacity: 0, transform: 'translateY(-54px) scale(.968)', filter: 'blur(5px)' },
  ], { duration: timings.exit, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' })
  if (!runtime.active()) return false
  runtime.phase('outgoing-complete')
  await runtime.delay(timings.exitGap)
  if (!runtime.active()) return false

  const sourceTitle = sharedSource.querySelector<HTMLElement>('strong')
  const sourceLocation = sharedSource.querySelector<HTMLElement>('small')
  const sourceTime = sharedSource.querySelector<HTMLElement>('time')
  const stageRect = stage.getBoundingClientRect()
  const targetRect = targetPrimary.getBoundingClientRect()
  const targetStyle = getComputedStyle(targetPrimary)
  const targetLocation = targetPrimary.querySelector<HTMLElement>('.course-location')
  const targetLocationRect = targetLocation?.getBoundingClientRect()
  const compactHeight = Math.min(
    targetRect.height,
    Math.max(62, (targetLocationRect?.bottom ?? targetRect.top + 62) - targetRect.top + 10),
  )
  const compactBottomInset = Math.max(0, 100 - (compactHeight / Math.max(1, targetRect.height)) * 100)

  const morph = document.createElement('div')
  morph.className = 'course-shared-morph'
  Object.assign(morph.style, {
    left: `${targetRect.left - stageRect.left}px`,
    top: `${targetRect.top - stageRect.top}px`,
    width: `${targetRect.width}px`,
    height: `${targetRect.height}px`,
    borderRadius: targetStyle.borderRadius,
  })

  const surface = targetPrimary.cloneNode(false) as HTMLElement
  surface.classList.add('course-morph-surface')
  surface.style.opacity = '0'
  surface.style.clipPath = `inset(0 48% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})`

  const targetLayer = targetPrimary.cloneNode(true) as HTMLElement
  targetLayer.classList.add('course-morph-target')
  targetLayer.style.opacity = '1'
  const targetTitleCopy = targetLayer.querySelector<HTMLElement>('h2')
  const targetLocationCopy = targetLayer.querySelector<HTMLElement>('.course-location')
  const targetTimeCopy = targetLayer.querySelector<HTMLElement>('.course-time')
  const fullTargetTime = targetTimeCopy?.textContent?.trim() ?? ''
  const [targetStartTime = '', ...targetEndParts] = fullTargetTime.split(/[–-]/)
  const targetEndTime = targetEndParts.join('–').trim()
  let targetTimePrefix: HTMLElement | null = null
  let targetTimeExtension: HTMLElement | null = null
  if (targetTimeCopy && targetStartTime) {
    targetTimeCopy.classList.add('is-shared-time-range')
    targetTimePrefix = document.createElement('span')
    targetTimePrefix.className = 'course-time-shared-prefix is-shared-copy-hidden'
    targetTimePrefix.textContent = targetStartTime.trim()
    targetTimeExtension = document.createElement('span')
    targetTimeExtension.className = 'course-time-extension'
    targetTimeExtension.textContent = targetEndTime ? `–${targetEndTime}` : ''
    targetTimeCopy.replaceChildren(targetTimePrefix, targetTimeExtension)
  }

  const targetCopies = [targetTitleCopy, targetLocationCopy, targetTimePrefix]
    .filter((copy): copy is HTMLElement => Boolean(copy))
  targetCopies.forEach((copy) => copy.classList.add('is-shared-copy-hidden'))

  const stateElement = targetLayer.querySelector<HTMLElement>('.focus-kicker')
  const countdownElement = targetLayer.querySelector<HTMLElement>('.countdown')
  const supportingParts = Array.from(targetLayer.querySelectorAll<HTMLElement>('.course-date, .course-flow'))
  const finalRevealParts = [stateElement, targetTimeExtension, countdownElement, ...supportingParts]
    .filter((part): part is HTMLElement => Boolean(part))
  finalRevealParts.forEach((part) => {
    part.style.opacity = '0'
    part.style.clipPath = 'inset(0 100% 0 0)'
    part.style.transform = 'translateY(3px)'
  })

  morph.append(surface, targetLayer)
  stage.append(morph)
  await runtime.nextFrame()
  if (!runtime.active()) return false

  const overlay = createOverlay(stage)
  const motions = [
    sharedTextMotion(sourceTitle, targetTitleCopy, overlay),
    sharedTextMotion(sourceLocation, targetLocationCopy, overlay),
    sharedTextMotion(sourceTime, targetTimePrefix, overlay),
  ].filter((motion): motion is SharedTextMotion => Boolean(motion))

  const wipe = document.createElement('div')
  wipe.className = 'course-final-wipe'
  Object.assign(wipe.style, {
    left: `${targetRect.left - stageRect.left}px`,
    top: `${targetRect.top - stageRect.top}px`,
    width: `${targetRect.width}px`,
    height: `${targetRect.height}px`,
    opacity: '0',
  })
  const wipeBeam = document.createElement('div')
  wipeBeam.className = 'course-final-wipe-beam'
  wipe.append(wipeBeam)
  overlay.append(wipe)
  runtime.phase('shared-text-moving')

  await Promise.all([
    ...motions.map((motion) => animate(motion.element, motion.keyframes, {
      duration: timings.sharedMove,
      easing: 'cubic-bezier(.2, .62, .18, 1)',
      fill: 'both',
    })),
    animate(surface, [
      { opacity: 0, clipPath: `inset(0 48% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
      { offset: .36, opacity: .24, clipPath: `inset(0 28% ${compactBottomInset * .7}% 0 round ${targetStyle.borderRadius})` },
      { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
    ], { duration: timings.shellReveal, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' }),
  ])
  if (!runtime.active()) return false

  const wipeAndSupportingReveal = Promise.all([
    animate(wipe, [
      { opacity: 0 },
      { offset: .08, opacity: 1 },
      { offset: .88, opacity: 1 },
      { opacity: 0 },
    ], { duration: timings.finalWipe, easing: 'linear', fill: 'both' }),
    animate(wipeBeam, [
      { transform: 'translate3d(-120%, 0, 0) skewX(-12deg)' },
      { transform: 'translate3d(245%, 0, 0) skewX(-12deg)' },
    ], { duration: timings.finalWipe, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' }),
    ...finalRevealParts.map((part, index) => animate(part, [
      { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: 'translateY(3px)' },
      { offset: .22, opacity: .16, clipPath: 'inset(0 76% 0 0)', transform: 'translateY(2px)' },
      { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' },
    ], {
      duration: timings.finalReveal,
      delay: 52 + index * 12,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    })),
  ])

  await Promise.all(motions.map((motion) => animate(motion.element, [
    { opacity: 1 },
    { offset: .52, opacity: .96 },
    { opacity: 0 },
  ], {
    duration: timings.textHandoff,
    delay: 92,
    easing: 'cubic-bezier(.4, 0, .7, .2)',
    fill: 'both',
  })))
  if (!runtime.active()) return false

  transferSharedTextOwnership(motions, targetCopies, runtime.phase)
  await wipeAndSupportingReveal
  if (!runtime.active()) return false

  overlay.remove()
  targetCopies.forEach((copy) => {
    clearElementAnimations(copy)
    copy.style.removeProperty('opacity')
  })
  finalRevealParts.forEach((part) => {
    clearElementAnimations(part)
    part.style.removeProperty('opacity')
    part.style.removeProperty('clip-path')
    part.style.removeProperty('transform')
  })
  if (targetTimeCopy) {
    targetTimeCopy.classList.remove('is-shared-time-range')
    targetTimeCopy.textContent = fullTargetTime
  }
  targetPrimary.replaceWith(targetLayer)
  targetLayer.classList.remove('course-morph-target')
  targetLayer.style.removeProperty('opacity')
  morph.remove()
  return true
}
