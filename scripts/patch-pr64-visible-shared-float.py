from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'Expected one {label}, found {count}')
    return source.replace(before, after, 1)


page_path = Path('src/widget-page.ts')
page = page_path.read_text(encoding='utf-8')
page = replace_once(
    page,
    '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHELL_PREP_MS = 820
const COURSE_SHARED_REFLOW_MS = 2600
const COURSE_FINAL_WIPE_MS = 760
const COURSE_FINAL_REVEAL_MS = 620
const COURSE_TEXT_HANDOFF_MS = 520
const COURSE_RESIZE_MS = 2600''',
    '''const COURSE_EXIT_MS = 640
const COURSE_EXIT_GAP_MS = 70
const COURSE_SHELL_FORM_MS = 1900
const COURSE_SHELL_FORM_DELAY_MS = 360
const COURSE_SHARED_REFLOW_MS = 2800
const COURSE_FINAL_WIPE_MS = 680
const COURSE_FINAL_REVEAL_MS = 500
const COURSE_TEXT_HANDOFF_MS = 430
const COURSE_RESIZE_MS = 2800''',
    'handoff timing constants',
)

helper_start = page.index('function sharedTextMotion(')
helper_end = page.index('function elementText(', helper_start)
helper = '''function sharedTextMotion(
  source: HTMLElement | null,
  target: HTMLElement | null,
  stage: HTMLElement,
) {
  if (!source || !target) return null
  const stageRect = stage.getBoundingClientRect()
  const sourceRect = source.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const sourceStyle = getComputedStyle(source)
  const targetStyle = getComputedStyle(target)
  const sourceSize = Number.parseFloat(sourceStyle.fontSize) || 1
  const targetSize = Number.parseFloat(targetStyle.fontSize) || sourceSize
  const scale = targetSize / sourceSize
  const deltaX = targetRect.left - sourceRect.left
  const deltaY = targetRect.top - sourceRect.top
  const floating = source.cloneNode(true) as HTMLElement
  floating.removeAttribute('id')
  floating.classList.add('course-shared-text', 'course-shared-float')
  Object.assign(floating.style, {
    left: `${sourceRect.left - stageRect.left}px`,
    top: `${sourceRect.top - stageRect.top}px`,
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
  stage.append(floating)
  return {
    element: floating,
    source,
    keyframes: [
      { opacity: 1, color: sourceStyle.color, transform: 'translate3d(0, 0, 0) scale(1)' },
      {
        offset: .18,
        opacity: 1,
        color: sourceStyle.color,
        transform: `translate3d(${deltaX * .08}px, ${deltaY * .08}px, 0) scale(${1 + (scale - 1) * .1})`,
      },
      {
        offset: .48,
        opacity: 1,
        color: targetStyle.color,
        transform: `translate3d(${deltaX * .45}px, ${deltaY * .45}px, 0) scale(${1 + (scale - 1) * .48})`,
      },
      {
        offset: .78,
        opacity: 1,
        color: targetStyle.color,
        fontWeight: targetStyle.fontWeight,
        letterSpacing: targetStyle.letterSpacing,
        transform: `translate3d(${deltaX * .82}px, ${deltaY * .82}px, 0) scale(${1 + (scale - 1) * .84})`,
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

'''
page = page[:helper_start] + helper + page[helper_end:]

page = replace_once(
    page,
    '''  body.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source, .course-shared-text').forEach((item) => {
    item.classList.remove('is-promoting-course', 'is-promoting-source', 'course-shared-text')
  })''',
    '''  body.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source, .course-shared-text').forEach((item) => {
    item.classList.remove('is-promoting-course', 'is-promoting-source', 'course-shared-text')
  })
  body.querySelectorAll<HTMLElement>('[data-shared-source-hidden]').forEach((item) => {
    item.style.removeProperty('visibility')
    delete item.dataset.sharedSourceHidden
  })''',
    'shared-source reset',
)
page = replace_once(
    page,
    "  stage.querySelector<HTMLElement>('.course-shared-morph')?.remove()\n",
    "  stage.querySelectorAll<HTMLElement>('.course-shared-morph, .course-shared-float').forEach((item) => item.remove())\n",
    'collapsed shared overlays',
)

page = replace_once(
    page,
    '''    const titleMotion = sharedTextMotion(sourceTitle, targetTitleCopy)
    const locationMotion = sharedTextMotion(sourceLocation, targetLocationCopy)
    const timeMotion = sharedTextMotion(sourceTime, targetTimePrefix)''',
    '''    const titleMotion = sharedTextMotion(sourceTitle, targetTitleCopy, stage)
    const locationMotion = sharedTextMotion(sourceLocation, targetLocationCopy, stage)
    const timeMotion = sharedTextMotion(sourceTime, targetTimePrefix, stage)''',
    'floating shared motions',
)

old_motion = '''    await animateElement(surface, [
      { opacity: 0, clipPath: `inset(0 46% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
      { offset: .36, opacity: .18, clipPath: `inset(0 28% ${compactBottomInset * .66}% 0 round ${targetStyle.borderRadius})` },
      { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
    ], {
      duration: COURSE_SHELL_PREP_MS,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    })
    if (token !== transitionToken) return

    stage.classList.add('is-live-resizing')
    await Promise.all([
      ...sharedMotions.map((motion) => animateElement(
        motion.element,
        motion.keyframes,
        {
          duration: COURSE_SHARED_REFLOW_MS,
          easing: 'cubic-bezier(.2, .62, .18, 1)',
          fill: 'both',
        },
      )),
      animateElement(stage, [
        { height: `${currentHeight}px` },
        { height: `${targetBodyHeight}px` },
      ], {
        duration: COURSE_RESIZE_MS,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',
      }),
    ])'''
new_motion = '''    currentWidget.classList.add('is-shared-reflowing')
    stage.classList.add('is-live-resizing')
    await Promise.all([
      ...sharedMotions.map((motion) => animateElement(
        motion.element,
        motion.keyframes,
        {
          duration: COURSE_SHARED_REFLOW_MS,
          easing: 'cubic-bezier(.2, .62, .18, 1)',
          fill: 'both',
        },
      )),
      animateElement(stage, [
        { height: `${currentHeight}px` },
        { height: `${targetBodyHeight}px` },
      ], {
        duration: COURSE_RESIZE_MS,
        easing: 'cubic-bezier(.2, .62, .18, 1)',
        fill: 'both',
      }),
      animateElement(surface, [
        { opacity: 0, clipPath: `inset(0 46% ${compactBottomInset}% 0 round ${targetStyle.borderRadius})` },
        { offset: .32, opacity: .12, clipPath: `inset(0 30% ${compactBottomInset * .72}% 0 round ${targetStyle.borderRadius})` },
        { opacity: 1, clipPath: `inset(0 0 0 0 round ${targetStyle.borderRadius})` },
      ], {
        duration: COURSE_SHELL_FORM_MS,
        delay: COURSE_SHELL_FORM_DELAY_MS,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      }),
    ])'''
page = replace_once(page, old_motion, new_motion, 'synchronized shared reflow')

page = replace_once(
    page,
    '''        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 170,''',
    '''        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 70,''',
    'source text handoff delay',
)
page = replace_once(
    page,
    '''        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 190,''',
    '''        duration: COURSE_TEXT_HANDOFF_MS,
        delay: 78,''',
    'target text handoff delay',
)
page = replace_once(
    page,
    '''        duration: COURSE_FINAL_REVEAL_MS,
        delay: 270 + index * 46,''',
    '''        duration: COURSE_FINAL_REVEAL_MS,
        delay: 36 + index * 18,''',
    'immediate final reveal',
)
page = replace_once(
    page,
    '''    targetCopies.forEach((copy) => {
      clearElementAnimations(copy)
      copy.style.removeProperty('opacity')
    })''',
    '''    sharedMotions.forEach((motion) => motion.element.remove())
    currentWidget.classList.remove('is-shared-reflowing')
    targetCopies.forEach((copy) => {
      clearElementAnimations(copy)
      copy.style.removeProperty('opacity')
    })''',
    'floating overlay cleanup',
)
page_path.write_text(page, encoding='utf-8')

css_path = Path('src/widget-page.css')
css = css_path.read_text(encoding='utf-8')
css = replace_once(
    css,
    '''.is-course-transitioning .course-widget {
  overflow: hidden;
  pointer-events: none;
  transform-style: preserve-3d;
}''',
    '''.is-course-transitioning .course-widget {
  overflow: hidden;
  pointer-events: none;
  transform-style: preserve-3d;
}

.is-course-transitioning .course-widget.is-shared-reflowing { overflow: visible; }''',
    'shared overflow rule',
)
css = replace_once(
    css,
    '''.course-shared-morph {
  position: absolute;
  z-index: 3;''',
    '''.course-shared-morph {
  position: absolute;
  z-index: 3;''',
    'morph anchor',
)
insert_after = '''.course-shared-morph {
  position: absolute;
  z-index: 3;
  overflow: hidden;
  box-sizing: border-box;
  pointer-events: none;
  transform-origin: top left;
  will-change: height, opacity;
}
'''
float_css = insert_after + '''
.course-shared-float {
  position: absolute;
  z-index: 9;
  display: block;
  width: max-content;
  max-width: none;
  margin: 0;
  padding: 0;
  white-space: nowrap;
  pointer-events: none;
  transform-origin: top left;
  will-change: transform, color, opacity;
}
'''
css = replace_once(css, insert_after, float_css, 'floating shared style')
css_path.write_text(css, encoding='utf-8')

check_path = Path('scripts/check-presentation-clock.mjs')
check = check_path.read_text(encoding='utf-8')
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /COURSE_SHELL_PREP_MS = 820/)
assert.match(widgetPageSource, /COURSE_SHARED_REFLOW_MS = 2600/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 760/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 620/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2600/)''',
    '''assert.match(widgetPageSource, /COURSE_SHELL_FORM_MS = 1900/)
assert.match(widgetPageSource, /COURSE_SHELL_FORM_DELAY_MS = 360/)
assert.match(widgetPageSource, /COURSE_SHARED_REFLOW_MS = 2800/)
assert.match(widgetPageSource, /COURSE_FINAL_WIPE_MS = 680/)
assert.match(widgetPageSource, /COURSE_FINAL_REVEAL_MS = 500/)
assert.match(widgetPageSource, /COURSE_RESIZE_MS = 2800/)''',
    'timing assertions',
)
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /const timeMotion = sharedTextMotion\(sourceTime, targetTimePrefix\)/)''',
    '''assert.match(widgetPageSource, /const timeMotion = sharedTextMotion\(sourceTime, targetTimePrefix, stage\)/)
assert.match(widgetPageSource, /floating\.classList\.add\('course-shared-text', 'course-shared-float'\)/)
assert.match(widgetPageSource, /source\.style\.visibility = 'hidden'/)
assert.match(widgetPageSource, /stage\.append\(floating\)/)''',
    'floating shared assertions',
)
check = replace_once(
    check,
    '''assert.match(widgetPageSource, /await Promise\.all\(\[[\s\S]*sharedMotions\.map[\s\S]*animateElement\(stage/)''',
    '''assert.match(widgetPageSource, /await Promise\.all\(\[[\s\S]*sharedMotions\.map[\s\S]*animateElement\(stage[\s\S]*animateElement\(surface/)
assert.match(widgetPageSource, /delay: COURSE_SHELL_FORM_DELAY_MS/)
assert.match(widgetPageSource, /delay: 36 \+ index \* 18/)
assert.match(widgetPageSource, /sharedMotions\.forEach\(\(motion\) => motion\.element\.remove\(\)\)/)''',
    'synchronized motion assertions',
)
check = replace_once(
    check,
    '''assert.match(widgetPageCss, /\.widget-body-handoff\.is-live-resizing/)
assert.match(widgetPageCss, /\.course-final-wipe/)''',
    '''assert.match(widgetPageCss, /\.widget-body-handoff\.is-live-resizing/)
assert.match(widgetPageCss, /\.course-shared-float/)
assert.match(widgetPageCss, /z-index: 9/)
assert.match(widgetPageCss, /course-widget\.is-shared-reflowing/)
assert.match(widgetPageCss, /\.course-final-wipe/)''',
    'floating css assertions',
)
check = check.replace(
    'synchronized shared-text reflow and window resizing, final-card wipe reveal',
    'always-visible floating shared-text reflow, synchronized window resizing, immediate final-card wipe reveal',
)
check_path.write_text(check, encoding='utf-8')
