import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatMinutesDuration } from '../src/duration.ts'
import { PresentationClock, validateReplayConfig } from '../src/presentation-clock.ts'

const config = {
  date: '2026-09-07',
  start: '08:00',
  end: '08:10',
  minutesPerSecond: 2,
  loop: false,
}

validateReplayConfig(config)
const clock = new PresentationClock()
let snapshot = clock.start(config, 1_000)
assert.equal(snapshot.date.getHours(), 8)
assert.equal(snapshot.date.getMinutes(), 0)
assert.equal(snapshot.playing, true)

snapshot = clock.snapshot(3_500)
assert.equal(snapshot.progress, 0.5)
assert.equal(snapshot.date.getHours(), 8)
assert.equal(snapshot.date.getMinutes(), 5)

snapshot = clock.pause(3_500)
assert.equal(snapshot.playing, false)
assert.equal(clock.snapshot(20_000).progress, 0.5)

snapshot = clock.resume(20_000)
assert.equal(snapshot.playing, true)
snapshot = clock.snapshot(22_500)
assert.equal(snapshot.finished, true)
assert.equal(snapshot.playing, false)
assert.equal(snapshot.date.getHours(), 8)
assert.equal(snapshot.date.getMinutes(), 10)

assert.throws(() => validateReplayConfig({ ...config, end: '07:00' }), /结束时间必须晚于开始时间/)
assert.throws(() => validateReplayConfig({ ...config, minutesPerSecond: 0 }), /1–5 分钟\/秒/)
assert.throws(() => validateReplayConfig({ ...config, minutesPerSecond: 6 }), /1–5 分钟\/秒/)

const adjustable = new PresentationClock()
adjustable.start(config, 0)
snapshot = adjustable.snapshot(1_000)
assert.equal(snapshot.date.getMinutes(), 2)
snapshot = adjustable.setSpeed(5, 1_000)
assert.equal(snapshot.date.getMinutes(), 2)
snapshot = adjustable.snapshot(1_600)
assert.equal(snapshot.progress, 0.5)
assert.equal(snapshot.date.getMinutes(), 5)

const looping = new PresentationClock()
looping.start({ ...config, loop: true }, 0)
snapshot = looping.snapshot(7_500)
assert.equal(snapshot.finished, false)
assert.equal(snapshot.progress, 0.5)
assert.equal(snapshot.date.getHours(), 8)
assert.equal(snapshot.date.getMinutes(), 5)

assert.equal(formatMinutesDuration(19), '19 分钟')
assert.equal(formatMinutesDuration(60), '1 小时')
assert.equal(formatMinutesDuration(96), '1 小时 36 分钟')
assert.equal(formatMinutesDuration(120), '2 小时')

const widgetSource = readFileSync(new URL('../src/widget.ts', import.meta.url), 'utf8')
const widgetPageSource = readFileSync(new URL('../src/widget-page.ts', import.meta.url), 'utf8')
const widgetPageCss = readFileSync(new URL('../src/widget-page.css', import.meta.url), 'utf8')
const timeFlowSource = readFileSync(new URL('../src/time-flow.ts', import.meta.url), 'utf8')
const timeFlowCss = readFileSync(new URL('../src/time-flow.css', import.meta.url), 'utf8')
const desktopShellSource = readFileSync(new URL('../src/desktop-shell.ts', import.meta.url), 'utf8')
const controllerSource = readFileSync(new URL('../src/presentation-page.ts', import.meta.url), 'utf8')
const eventSource = readFileSync(new URL('../src/presentation-events.ts', import.meta.url), 'utf8')
const tauriConfig = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')

assert.match(widgetSource, /now\?: Date/)
assert.match(widgetSource, /const now = options\.now \? new Date\(options\.now\) : new Date\(\)/)
assert.match(widgetSource, /const today = startOfDay\(options\.now \?\? new Date\(\)\)/)
assert.match(widgetSource, /<div class="widget-body">/)
assert.match(widgetSource, /formatMinutesDuration\(parseTime\(model\.focus\.end\) - nowMinutes\)/)
assert.match(widgetSource, /formatMinutesDuration\(parseTime\(model\.focus\.start\) - nowMinutes\)/)
assert.match(timeFlowSource, /formatMinutesDuration\(minutesUntilEnd\)/)
assert.match(widgetPageSource, /options\.now = snapshot\.date/)
const widgetPageCssImport = widgetPageSource.indexOf("import './widget-page.css'")
const timeFlowCssImport = widgetPageSource.indexOf("import './time-flow.css'")
assert.ok(
  widgetPageCssImport >= 0 && widgetPageCssImport < timeFlowCssImport,
  'time-flow.css loads after widget-page.css, so morph selectors must outrank shared focus-course rules',
)
assert.match(widgetPageSource, /WebviewWindow\.getByLabel\('presentation'\)/)
assert.match(widgetPageSource, /PRESENTATION_COMMAND_EVENT/)
assert.match(widgetPageSource, /presentationClock\.pause\(timestamp\)/)
assert.match(widgetPageSource, /presentationClock\.setSpeed\(minutesPerSecond/)
assert.match(widgetPageSource, /COURSE_EXIT_MS = 640/)
assert.match(widgetPageSource, /COURSE_EXIT_GAP_MS = 70/)
assert.match(widgetPageSource, /COURSE_SHARED_MOVE_MS = 2100/)
assert.match(widgetPageSource, /COURSE_SHELL_REVEAL_MS = 900/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 760/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 420/)
assert.match(widgetPageSource, /COURSE_TEXT_HANDOFF_MS = 420/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 1150/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHELL_REVEAL_DELAY_MS/)
assert.doesNotMatch(widgetPageSource, /COURSE_SHELL_FORM|COURSE_SHARED_REFLOW|is-shared-reflowing/)
assert.match(widgetPageSource, /function courseIdentityKey/)
assert.doesNotMatch(widgetPageSource, /const phase =/)
assert.match(widgetPageSource, /if \(currentWidget && !courseChanged\)/)
assert.match(widgetPageSource, /function findSharedCourseSource/)
assert.match(widgetPageSource, /function createCourseTransitionOverlay\(stage: HTMLElement\)/)
assert.match(widgetPageSource, /function removeCourseTransitionOverlay/)
assert.match(widgetPageSource, /stage\.append\(overlay\)/)
assert.match(widgetPageSource, /const overlayRect = overlay\.getBoundingClientRect\(\)/)
assert.match(widgetPageSource, /sourceRect\.left - overlayRect\.left/)
assert.match(widgetPageSource, /sourceRect\.top - overlayRect\.top/)
assert.match(widgetPageSource, /type SharedTextMotion/)
assert.match(widgetPageSource, /source\.dataset\.sharedSourceHidden = 'true'/)
assert.match(widgetPageSource, /source\.style\.visibility = 'hidden'/)
assert.match(widgetPageSource, /overlay\.append\(floating\)/)
assert.match(widgetPageSource, /sharedTextMotion\(sourceTitle, targetTitleCopy, overlay\)/)
assert.match(widgetPageSource, /sharedTextMotion\(sourceLocation, targetLocationCopy, overlay\)/)
assert.match(widgetPageSource, /sharedTextMotion\(sourceTime, targetTimePrefix, overlay\)/)
assert.match(widgetPageSource, /createCourseTransitionOverlay\(stage\)/)
assert.match(widgetPageSource, /targetRect\.left - stageRect\.left/)
assert.match(widgetPageSource, /targetRect\.top - stageRect\.top/)
assert.match(widgetPageSource, /duration: COURSE_SHARED_MOVE_MS/)
assert.match(widgetPageSource, /await Promise\.all\(\[\s*\.\.\.sharedMotions\.map[\s\S]*animateElement\(surface/)
assert.doesNotMatch(widgetPageSource, /is-live-resizing/)
assert.ok(
  widgetPageSource.lastIndexOf('removeCourseTransitionOverlay()') <
    widgetPageSource.indexOf("stage.classList.add('is-size-settling')"),
  'overlay text and final card must complete before the stage height changes',
)
assert.match(widgetPageSource, /wipe\.className = 'course-final-wipe'/)
assert.match(widgetPageSource, /wipeBeam\.className = 'course-final-wipe-beam'/)
assert.match(widgetPageSource, /wipe\.append\(wipeBeam\)/)
assert.match(widgetPageSource, /animateElement\(wipeBeam/)
assert.match(widgetPageSource, /overlay\.append\(wipe\)/)
assert.match(widgetPageSource, /delay: 52 \+ index \* 12/)
assert.match(widgetPageSource, /removeCourseTransitionOverlay\(\)/)
assert.match(widgetPageSource, /window\.dispatchEvent\(new Event\('course-transition:complete'\)\)/)
assert.doesNotMatch(widgetPageSource, /currentWidget\.classList\.add\('is-shared-reflowing'\)/)
assert.doesNotMatch(widgetPageSource, /sourceLayer|is-shared-course-source|course-shared-text/)
assert.match(widgetPageSource, /targetPrimary\.replaceWith\(targetLayer\)/)
assert.match(widgetPageSource, /stage\.replaceChildren\(nextBody\)/)
assert.match(widgetPageSource, /stage\.replaceWith\(nextBody\)/)
const overlayRemoval = widgetPageSource.lastIndexOf('removeCourseTransitionOverlay()')
const targetDomHandoff = widgetPageSource.indexOf('targetPrimary.replaceWith(targetLayer)')
const nextBodySwap = widgetPageSource.indexOf('stage.replaceChildren(nextBody)')
const sizeSettling = widgetPageSource.indexOf("stage.classList.add('is-size-settling')")
const finalBodySwap = widgetPageSource.indexOf('stage.replaceWith(nextBody)')
const transitionFinish = widgetPageSource.lastIndexOf('finishCourseTransition(token, resumeAfterTransition)')
assert.ok(overlayRemoval < targetDomHandoff, 'floating text must hand off before temporary morph replacement')
assert.ok(targetDomHandoff < nextBodySwap, 'target text DOM must be complete before nextBody replaces the handoff layers')
assert.ok(nextBodySwap < sizeSettling && sizeSettling < finalBodySwap, 'component height may settle only after the real nextBody is installed')
assert.ok(finalBodySwap < transitionFinish, 'presentation clock may resume only after the final body and height transition complete')
assert.match(widgetPageSource, /function transferSharedTextOwnership\(sharedMotions: SharedTextMotion\[], targetCopies: HTMLElement\[]\)/)
assert.doesNotMatch(widgetPageSource, /targetCopies\.map\(\(copy\) => animateElement/)
assert.equal((widgetPageSource.match(/copy\.classList\.remove\('is-shared-copy-hidden'\)/g) ?? []).length, 1)
const ownershipHelper = widgetPageSource.indexOf('function transferSharedTextOwnership')
const movingCopyHidden = widgetPageSource.indexOf("motion.element.style.visibility = 'hidden'", ownershipHelper)
const targetCopyRevealed = widgetPageSource.indexOf("copy.classList.remove('is-shared-copy-hidden')", ownershipHelper)
assert.ok(
  ownershipHelper >= 0 && movingCopyHidden > ownershipHelper && movingCopyHidden < targetCopyRevealed,
  'moving copies must be fully hidden before target copies become visible',
)
const wipeRevealStart = widgetPageSource.indexOf('const wipeAndSupportingReveal = Promise.all([')
const movingCopyFade = widgetPageSource.lastIndexOf('await Promise.all(sharedMotions.map')
const ownershipTransfer = widgetPageSource.indexOf('transferSharedTextOwnership(sharedMotions, targetCopies)', movingCopyFade)
const wipeRevealAwait = widgetPageSource.indexOf('await wipeAndSupportingReveal', ownershipTransfer)
assert.ok(
  wipeRevealStart >= 0
    && wipeRevealStart < movingCopyFade
    && movingCopyFade < ownershipTransfer
    && ownershipTransfer < wipeRevealAwait
    && wipeRevealAwait < overlayRemoval,
  'target text ownership must switch only after moving copies finish fading and before overlay removal',
)
assert.match(widgetPageSource, /if \(!currentWidget\) \{[\s\S]*nextWidget\.classList\.add\('is-initial-mount'\)/)
assert.doesNotMatch(widgetPageSource, /prepareIncomingElement/)
assert.doesNotMatch(widgetPageSource, /is-handoff-incoming/)
assert.doesNotMatch(widgetPageSource, /is-handoff-outgoing/)
assert.doesNotMatch(widgetPageSource, /app\.append\(nextWidget\)/)
assert.doesNotMatch(widgetPageSource, /startViewTransition/)
assert.doesNotMatch(widgetPageSource, /function stateKey/)
assert.match(widgetPageSource, /transitioning: transitionActive/)
assert.match(desktopShellSource, /let pendingHeight: number \| undefined/)
assert.match(desktopShellSource, /while \(pendingHeight !== undefined\)/)
assert.match(desktopShellSource, /resizeDeferredForTransition/)
assert.match(desktopShellSource, /classList\.contains\('is-course-transitioning'\)/)
assert.match(desktopShellSource, /course-transition:complete/)
assert.match(desktopShellSource, /applyDeferredTransitionSize/)
assert.match(desktopShellSource, /await appWindow\.setSize/)
assert.match(controllerSource, /PRESENTATION_STATUS_REQUEST_EVENT/)
assert.match(controllerSource, /录制时只捕获课刻窗口/)
assert.match(controllerSource, /min="1" max="5"/)
assert.match(controllerSource, /快速观察 · 5 分钟\/秒/)
assert.match(controllerSource, /不含课程转场停顿/)
assert.match(controllerSource, /type: 'set-speed'/)
assert.match(controllerSource, /课程转场/)
assert.match(eventSource, /type: 'set-speed'/)
assert.match(widgetPageCss, /perspective: 1000px/)
assert.match(widgetPageCss, /\.widget-body \{[\s\S]*display: flow-root/)
assert.match(widgetPageCss, /\.widget-body-handoff/)
assert.match(widgetPageCss, /\.course-shared-morph/)
const morphLayerRule = /\.course-widget \.course-shared-morph > \.course-morph-surface,\s*\.course-widget \.course-shared-morph > \.course-morph-target\s*\{([^}]*)\}/.exec(widgetPageCss)?.[1] ?? ''
assert.match(morphLayerRule, /position:\s*absolute/)
assert.match(morphLayerRule, /inset:\s*0/)
const classSpecificity = (selector) => (selector.match(/\.[\w-]+/g) ?? []).length
assert.ok(
  classSpecificity('.course-widget .course-shared-morph > .course-morph-target') >
    classSpecificity('.course-widget .focus-course'),
  'morph-layer selector must outrank the later focus-course position rule',
)
assert.match(widgetPageCss, /border-color: transparent !important/)
assert.match(widgetPageCss, /\.course-transition-overlay/)
const transitionOverlayRule = /\.course-transition-overlay\s*\{([^}]*)\}/.exec(widgetPageCss)?.[1] ?? ''
assert.match(transitionOverlayRule, /position: absolute/)
assert.match(transitionOverlayRule, /overflow: hidden/)
assert.doesNotMatch(transitionOverlayRule, /position: fixed|overflow: visible/)
const currentBodyRule = /\.widget-body-handoff > \.widget-body\.is-handoff-current\s*\{([^}]*)\}/.exec(widgetPageCss)?.[1] ?? ''
const overlayZIndex = Number(/z-index:\s*(\d+)/.exec(transitionOverlayRule)?.[1])
const currentBodyZIndex = Number(/z-index:\s*(\d+)/.exec(currentBodyRule)?.[1])
assert.equal(overlayZIndex, 6)
assert.ok(overlayZIndex > currentBodyZIndex, 'shared text and wipe must render above the outgoing course body')
assert.match(widgetPageCss, /\.course-shared-float/)
assert.equal((widgetPageCss.match(/\.course-shared-float\s*\{/g) ?? []).length, 1)
assert.match(widgetPageCss, /\.course-final-wipe/)
assert.match(widgetPageCss, /\.course-final-wipe-beam/)
assert.doesNotMatch(widgetPageCss, /\.course-final-wipe::before/)
const wipeBeamRule = /\.course-final-wipe-beam\s*\{([^}]*)\}/.exec(widgetPageCss)?.[1] ?? ''
assert.match(wipeBeamRule, /width:\s*34%/)
assert.doesNotMatch(wipeBeamRule, /mix-blend-mode/)
assert.doesNotMatch(widgetPageCss, /is-shared-reflowing/)
assert.match(widgetPageCss, /visibility: hidden/)
assert.match(widgetPageCss, /is-size-settling/)
assert.match(widgetPageCss, /animation: none !important/)
assert.match(widgetPageCss, /will-change: opacity, transform, filter/)
assert.doesNotMatch(widgetPageCss, /0 18px 55px/)
assert.doesNotMatch(widgetPageCss, /\.course-widget\.is-handoff-outgoing/)
assert.doesNotMatch(widgetPageCss, /::view-transition/)
const baseFocusRule = /\.course-widget \.focus-course \{([^}]*)\}/.exec(timeFlowCss)?.[1] ?? ''
assert.match(baseFocusRule, /position:\s*relative/)
assert.doesNotMatch(baseFocusRule, /animation:/)
assert.match(timeFlowCss, /\.course-widget\.is-initial-mount \.focus-course \{[\s\S]*animation: time-flow-enter/)
assert.match(tauriConfig, /"label": "presentation"/)
assert.doesNotMatch(widgetPageSource, /presentation-panel/)
assert.doesNotMatch(widgetPageSource, /withPresentationDate/)

console.log('presentation clock, single-owner shared-text handoff, cascade-safe morph positioning, visible overlay, non-blended wipe beam, ordered DOM handoff, deferred native resize, duration formatting, controller, and widget wiring checks passed')
