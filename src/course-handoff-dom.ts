/**
 * DOM contract for the shared course handoff engine.
 *
 * Widgets supplied to this module are expected to come from `createWidget` and keep:
 * - `.widget-body` as the replaceable content root;
 * - `.focus-course` with `h2`, `.course-time`, `.course-location`, and `.course-date`;
 * - `.following .timeline li` with `strong`, `time`, and optional `small` course metadata;
 * - `.state-label`, `.empty-state`, or `.opening-date` for non-course states.
 *
 * When widget markup changes, update this module and the execution-level coverage in
 * `website/tests/course-handoff.spec.ts` together. These selectors are an intentional
 * shared contract between the desktop presentation and website experience demo.
 */
export function courseIdentityKey(widget: HTMLElement | null) {
  if (!widget) return ''
  const focus = widget.querySelector<HTMLElement>('.focus-course')
  if (focus) {
    const course = focus.querySelector<HTMLElement>('h2')?.textContent ?? ''
    const courseTime = focus.querySelector<HTMLElement>('.course-time')?.textContent ?? ''
    const focusDate = focus.querySelector<HTMLElement>('.course-date')?.textContent ?? ''
    return `course|${course}|${courseTime}|${focusDate}`
  }
  const state = widget.querySelector<HTMLElement>('.state-label, .empty-state, .opening-date')?.textContent ?? ''
  return `state|${state}`
}

function syncAttributes(current: Element, next: Element) {
  Array.from(current.attributes).forEach((attribute) => {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name)
  })
  Array.from(next.attributes).forEach((attribute) => {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value)
  })
}

export function syncNode(current: Node, next: Node): void {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.parentNode?.replaceChild(next.cloneNode(true), current)
    return
  }
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
    return
  }
  if (!(current instanceof Element) || !(next instanceof Element)) return
  syncAttributes(current, next)
  const currentChildren = Array.from(current.childNodes)
  const nextChildren = Array.from(next.childNodes)
  const sharedLength = Math.min(currentChildren.length, nextChildren.length)
  for (let index = 0; index < sharedLength; index += 1) syncNode(currentChildren[index], nextChildren[index])
  for (let index = currentChildren.length - 1; index >= nextChildren.length; index -= 1) {
    currentChildren[index].parentNode?.removeChild(currentChildren[index])
  }
  for (let index = currentChildren.length; index < nextChildren.length; index += 1) {
    current.appendChild(nextChildren[index].cloneNode(true))
  }
}

export function syncStableWidget(current: HTMLElement, next: HTMLElement) {
  syncNode(current, next)
}

export function transitionPrimary(root: ParentNode | null) {
  return root?.querySelector<HTMLElement>('.focus-course, .state-label, .empty-state, .opening-date') ?? null
}

export function transitionSecondary(root: ParentNode | null) {
  return root?.querySelector<HTMLElement>('.following') ?? null
}

function elementText(root: ParentNode | null, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() ?? ''
}

export function findSharedCourseSource(currentBody: HTMLElement, nextBody: HTMLElement) {
  const nextFocus = nextBody.querySelector<HTMLElement>('.focus-course')
  const nextName = elementText(nextFocus, 'h2')
  const nextStart = elementText(nextFocus, '.course-time').split(/[–-]/)[0]?.trim() ?? ''
  if (!nextName || !nextStart) return null
  return Array.from(currentBody.querySelectorAll<HTMLElement>('.following .timeline li')).find((item) => (
    elementText(item, 'strong') === nextName && elementText(item, 'time') === nextStart
  )) ?? null
}

export function clearElementAnimations(element: HTMLElement | null) {
  element?.getAnimations().forEach((animation) => animation.cancel())
}

export function resetHandoffBody(body: HTMLElement) {
  body.classList.remove('is-handoff-current', 'is-handoff-target')
  body.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source').forEach((item) => {
    item.classList.remove('is-promoting-course', 'is-promoting-source')
  })
  body.querySelectorAll<HTMLElement>('[data-shared-source-hidden]').forEach((item) => {
    item.style.removeProperty('visibility')
    delete item.dataset.sharedSourceHidden
  })
  body.querySelectorAll<HTMLElement>('.is-shared-copy-hidden').forEach((item) => item.classList.remove('is-shared-copy-hidden'))
}

export function cleanupTransient(host: HTMLElement) {
  host.querySelectorAll<HTMLElement>('.course-transition-overlay, .course-shared-morph, .course-shared-float, .course-final-wipe').forEach((item) => item.remove())
  host.querySelectorAll<HTMLElement>('[data-shared-source-hidden]').forEach((source) => {
    source.style.removeProperty('visibility')
    delete source.dataset.sharedSourceHidden
  })
  host.querySelectorAll<HTMLElement>('.is-promoting-course, .is-promoting-source').forEach((item) => {
    item.classList.remove('is-promoting-course', 'is-promoting-source')
  })
  host.querySelectorAll<HTMLElement>('.is-shared-copy-hidden').forEach((item) => item.classList.remove('is-shared-copy-hidden'))
}
