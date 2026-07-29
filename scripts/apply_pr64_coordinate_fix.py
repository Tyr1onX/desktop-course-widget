from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def exact(text: str, old: str, new: str, label: str, expected: int = 1) -> str:
    count = text.count(old)
    print(f"[patch] {label}: {count}")
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected}, found {count}")
    return text.replace(old, new)


def regex(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, lambda _: replacement, text, flags=flags)
    print(f"[patch] {label}: {count}")
    if count != 1:
        raise RuntimeError(f"{label}: expected 1, found {count}")
    return updated


def replace_line_range(lines: list[str], start: str, end: str, replacement: list[str], label: str) -> list[str]:
    try:
        start_index = lines.index(start)
        end_index = lines.index(end, start_index)
    except ValueError as error:
        raise RuntimeError(f"{label}: boundary not found") from error
    print(f"[patch] {label}: lines {start_index + 1}-{end_index + 1}")
    return lines[:start_index] + replacement + lines[end_index + 1 :]


def patch_widget_page() -> None:
    path = "src/widget-page.ts"
    text = read(path)

    text = regex(
        text,
        r"function createCourseTransitionOverlay\(\) \{.*?\n\}",
        """function createCourseTransitionOverlay(stage: HTMLElement) {
  removeCourseTransitionOverlay()
  const overlay = document.createElement('div')
  overlay.className = 'course-transition-overlay'
  stage.append(overlay)
  return overlay
}""",
        "stage-local overlay factory",
        re.S,
    )
    text = exact(
        text,
        """  const sourceRect = source.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const sourceStyle = getComputedStyle(source)""",
        """  const sourceRect = source.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const overlayRect = overlay.getBoundingClientRect()
  const sourceStyle = getComputedStyle(source)""",
        "overlay coordinate origin",
    )
    text = exact(
        text,
        """    left: `${sourceRect.left}px`,
    top: `${sourceRect.top}px`,""",
        """    left: `${sourceRect.left - overlayRect.left}px`,
    top: `${sourceRect.top - overlayRect.top}px`,""",
        "stage-relative shared text",
    )

    release_call = "document.documentElement.classList.remove('is-course-transitioning')"
    if text.count(release_call) != 2:
        raise RuntimeError(f"transition release calls: expected 2, found {text.count(release_call)}")
    text = text.replace(release_call, "releaseCourseTransitionWindow()")
    text = exact(
        text,
        "function clearCourseTransition() {",
        """function releaseCourseTransitionWindow() {
  document.documentElement.classList.remove('is-course-transitioning')
  window.dispatchEvent(new Event('course-transition:complete'))
}

function clearCourseTransition() {""",
        "transition completion event",
    )

    text = exact(text, "let resizedDuringSharedHandoff = false", "let sharedHandoffCompleted = false", "shared state")
    text = exact(text, "createCourseTransitionOverlay()", "createCourseTransitionOverlay(stage)", "overlay call")
    text = regex(
        text,
        r"(Object\.assign\(wipe\.style, \{\s*left: `\$\{)targetRect\.left(\}px`,\s*top: `\$\{)targetRect\.top(\}px`)",
        r"\1targetRect.left - stageRect.left\2targetRect.top - stageRect.top\3",
        "stage-relative wipe",
        re.S,
    )

    text = regex(
        text,
        r"    await Promise\.all\(sharedMotions\.map\(\(motion\) => animateElement\(motion\.element, motion\.keyframes, \{.*?    resizedDuringSharedHandoff = true",
        """    await Promise.all([
      ...sharedMotions.map((motion) => animateElement(motion.element, motion.keyframes, {
        duration: COURSE_SHARED_MOVE_MS,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',
      })),
      animateElement(surface, [
        { opacity: 0, clipPath: `inset(0 48% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
        { offset: .36, opacity: .24, clipPath: `inset(0 28% ${compactBottomInset * .7}% 0 round ${targetStyle.borderRadius})` },
        { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
      ], {
        duration: COURSE_SHELL_REVEAL_MS,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      }),
    ])
    if (token !== transitionToken) return""",
        "shared text and shell phase",
        re.S,
    )
    text = exact(
        text,
        """    morph.remove()
  } else {""",
        """    morph.remove()
    sharedHandoffCompleted = true
  } else {""",
        "mark shared handoff",
    )
    text = exact(
        text,
        "if (resizedDuringSharedHandoff && nextFollowing)",
        "if (sharedHandoffCompleted && nextFollowing)",
        "following condition",
    )
    text = regex(
        text,
        r"  if \(resizedDuringSharedHandoff\) \{.*?\n  \}\n\n  stage\.style\.removeProperty\('height'\)",
        """  await Promise.all([
    animateElement(stage, [
      { height: `${currentHeight}px` },
      { height: `${targetHeight}px` },
    ], {
      duration: COURSE_RESIZE_MS,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    }),
    animateElement(nextFollowing, [
      {
        opacity: 0,
        transform: `translateY(${sharedHandoffCompleted ? 10 : 14}px)`,
      },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: sharedHandoffCompleted ? 560 : 720,
      delay: sharedHandoffCompleted ? 80 : 140,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    }),
  ])
  if (token !== transitionToken) return
  if (nextFollowing) {
    clearElementAnimations(nextFollowing)
    nextFollowing.style.removeProperty('opacity')
    nextFollowing.style.removeProperty('transform')
  }

  stage.style.removeProperty('height')""",
        "post-content stage resize",
        re.S,
    )
    write(path, text)


def patch_css() -> None:
    path = "src/widget-page.css"
    text = read(path)
    text = regex(
        text,
        r"\.widget-body-handoff\.is-live-resizing \{ will-change: height; \}\n\n\.course-transition-overlay \{.*?\n\}",
        """.course-transition-overlay {
  position: absolute;
  z-index: 4;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}""",
        "clipped stage-local overlay CSS",
        re.S,
    )
    write(path, text)


def patch_desktop_shell() -> None:
    path = "src/desktop-shell.ts"
    text = read(path)
    text = exact(
        text,
        """  let resizeFrame: number | undefined
  let sizePump: Promise<void> | undefined""",
        """  let resizeFrame: number | undefined
  let sizePump: Promise<void> | undefined
  let resizeDeferredForTransition = false""",
        "resize deferral state",
    )
    text = exact(
        text,
        """  const applyHeight = async (height: number) => {
    if (lastAppliedHeight !== undefined && Math.abs(lastAppliedHeight - height) < 0.5) return""",
        """  const applyHeight = async (height: number) => {
    if (document.documentElement.classList.contains('is-course-transitioning')) {
      resizeDeferredForTransition = true
      return
    }
    if (lastAppliedHeight !== undefined && Math.abs(lastAppliedHeight - height) < 0.5) return""",
        "queued resize guard",
    )
    text = exact(
        text,
        """  const queueSize = () => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)""",
        """  const queueSize = () => {
    if (document.documentElement.classList.contains('is-course-transitioning')) {
      resizeDeferredForTransition = true
      return
    }
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)""",
        "observer resize guard",
    )
    text = exact(
        text,
        "  const observer = new ResizeObserver(queueSize)",
        """  const applyDeferredTransitionSize = () => {
    if (!resizeDeferredForTransition) return
    resizeDeferredForTransition = false
    queueSize()
  }

  window.addEventListener('course-transition:complete', applyDeferredTransitionSize)
  const observer = new ResizeObserver(queueSize)""",
        "deferred resize listener",
    )
    text = exact(
        text,
        "window.addEventListener('beforeunload', () => { observer.disconnect(); unlistenScale() }, { once: true })",
        """window.addEventListener('beforeunload', () => {
    observer.disconnect()
    window.removeEventListener('course-transition:complete', applyDeferredTransitionSize)
    unlistenScale()
  }, { once: true })""",
        "listener cleanup",
    )
    write(path, text)


def patch_checks() -> None:
    path = "scripts/check-presentation-clock.mjs"
    lines = read(path).splitlines()

    lines = replace_line_range(
        lines,
        "assert.match(widgetPageSource, /function createCourseTransitionOverlay/)",
        "assert.match(widgetPageSource, /type SharedTextMotion/)",
        [
            "assert.match(widgetPageSource, /function createCourseTransitionOverlay\\(stage: HTMLElement\\)/)",
            "assert.match(widgetPageSource, /function removeCourseTransitionOverlay/)",
            "assert.match(widgetPageSource, /stage\\.append\\(overlay\\)/)",
            "assert.match(widgetPageSource, /const overlayRect = overlay\\.getBoundingClientRect\\(\\)/)",
            "assert.match(widgetPageSource, /sourceRect\\.left - overlayRect\\.left/)",
            "assert.match(widgetPageSource, /sourceRect\\.top - overlayRect\\.top/)",
            "assert.match(widgetPageSource, /type SharedTextMotion/)",
        ],
        "overlay checks",
    )

    start = lines.index("assert.match(widgetPageSource, /sharedTextMotion\\(sourceTime, targetTimePrefix, overlay\\)/)")
    end = lines.index("assert.match(widgetPageSource, /wipe\\.className = 'course-final-wipe'/)", start)
    lines[start:end] = [
        "assert.match(widgetPageSource, /sharedTextMotion\\(sourceTime, targetTimePrefix, overlay\\)/)",
        "assert.match(widgetPageSource, /createCourseTransitionOverlay\\(stage\\)/)",
        "assert.match(widgetPageSource, /targetRect\\.left - stageRect\\.left/)",
        "assert.match(widgetPageSource, /targetRect\\.top - stageRect\\.top/)",
        "assert.match(widgetPageSource, /duration: COURSE_SHARED_MOVE_MS/)",
        "assert.match(widgetPageSource, /await Promise\\.all\\(\\[\\s*\\.\\.\\.sharedMotions\\.map[\\s\\S]*animateElement\\(surface/)",
        "assert.doesNotMatch(widgetPageSource, /is-live-resizing/)",
        "assert.ok(",
        "  widgetPageSource.lastIndexOf('removeCourseTransitionOverlay()') <",
        "    widgetPageSource.indexOf(\"stage.classList.add('is-size-settling')\"),",
        "  'overlay text and final card must complete before the stage height changes',",
        ")",
    ]

    remove_line = "assert.match(widgetPageSource, /removeCourseTransitionOverlay\\(\\)/)"
    remove_index = lines.index(remove_line)
    lines.insert(remove_index + 1, "assert.match(widgetPageSource, /window\\.dispatchEvent\\(new Event\\('course-transition:complete'\\)\\)/)")

    shell_start = lines.index("assert.match(desktopShellSource, /let pendingHeight: number \\| undefined/)")
    shell_end = lines.index("assert.match(desktopShellSource, /await appWindow\\.setSize/)", shell_start)
    lines[shell_start : shell_end + 1] = [
        "assert.match(desktopShellSource, /let pendingHeight: number \\| undefined/)",
        "assert.match(desktopShellSource, /while \\(pendingHeight !== undefined\\)/)",
        "assert.match(desktopShellSource, /resizeDeferredForTransition/)",
        "assert.match(desktopShellSource, /classList\\.contains\\('is-course-transitioning'\\)/)",
        "assert.match(desktopShellSource, /course-transition:complete/)",
        "assert.match(desktopShellSource, /applyDeferredTransitionSize/)",
        "assert.match(desktopShellSource, /await appWindow\\.setSize/)",
    ]

    css_start = lines.index("assert.match(widgetPageCss, /\\.course-transition-overlay/)")
    css_end = lines.index("assert.match(widgetPageCss, /z-index: 2147483000/)", css_start)
    lines[css_start : css_end + 1] = [
        "assert.match(widgetPageCss, /\\.course-transition-overlay/)",
        "const transitionOverlayRule = /\\.course-transition-overlay\\s*\\{([^}]*)\\}/.exec(widgetPageCss)?.[1] ?? ''",
        "assert.match(transitionOverlayRule, /position: absolute/)",
        "assert.match(transitionOverlayRule, /overflow: hidden/)",
        "assert.doesNotMatch(transitionOverlayRule, /position: fixed|overflow: visible/)",
        "assert.match(transitionOverlayRule, /z-index: 4/)",
    ]

    old_summary = "console.log('presentation clock, exact shared-time alignment, sequential shared-text then resize handoff, visible beam wipe reveal, duration formatting, controller, and widget wiring checks passed')"
    summary_index = lines.index(old_summary)
    lines[summary_index] = "console.log('presentation clock, stage-local shared text and shell handoff, deferred native window resize, visible beam wipe reveal, duration formatting, controller, and widget wiring checks passed')"
    write(path, "\n".join(lines) + "\n")


patch_widget_page()
patch_css()
patch_desktop_shell()
patch_checks()
print("PR 64 coordinate-space fix applied")
