declare const __COURSE_WIDGET_BUILD_SHA__: string

function shortBuildSha(): string {
  const value = typeof __COURSE_WIDGET_BUILD_SHA__ === 'string'
    ? __COURSE_WIDGET_BUILD_SHA__.trim()
    : ''
  if (!value) return 'unknown'
  return value === 'local' ? value : value.slice(0, 8)
}

function compactText(value: string): string {
  return value.replace(/\s+/g, '')
}

function looksLikeAuxiliaryRow(value: string): boolean {
  const compact = compactText(value)
  return /^[（(][^0-9０-９OoIl]{0,2}[0-9０-９OoIl]{3,8}/.test(compact)
    || /^(?:调|停)[0-9０-９OoIl]{3,8}/.test(compact)
}

function courseName(card: Element): string {
  return card.querySelector('.import-course-copy strong')?.textContent?.trim() || ''
}

function updateDiagnostics(): void {
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface || surface.dataset.screenshotImportMode !== 'review') return

  const intro = surface.querySelector<HTMLElement>('.surface-intro')
  if (!intro) return

  const cards = [...surface.querySelectorAll<HTMLElement>('.import-course-review')]
  const names = cards.map(courseName).filter(Boolean)
  const missingLocationNames = cards
    .filter((card) => card.querySelector('.import-course-copy')?.textContent?.includes('地点：未识别'))
    .map(courseName)
    .filter(Boolean)
  const auxiliaryNames = names.filter(looksLikeAuxiliaryRow)
  const diagnostic = [
    `Build ${shortBuildSha()}`,
    `rendered ${cards.length}`,
    `missing-location ${missingLocationNames.length}`,
    missingLocationNames.length ? `missing=${missingLocationNames.join(' / ')}` : '',
    `aux-like ${auxiliaryNames.length}`,
    auxiliaryNames.length ? `aux=${auxiliaryNames.join(' / ')}` : '',
  ].filter(Boolean).join(' · ')

  let element = intro.querySelector<HTMLElement>('[data-screenshot-import-diagnostics]')
  if (!element) {
    element = document.createElement('code')
    element.dataset.screenshotImportDiagnostics = 'true'
    element.style.display = 'block'
    element.style.marginTop = '6px'
    element.style.fontSize = '12px'
    element.style.lineHeight = '1.5'
    element.style.whiteSpace = 'normal'
    element.style.wordBreak = 'break-word'
    element.style.color = 'var(--muted, #6b7280)'
    intro.append(element)
  }
  if (element.dataset.diagnosticValue !== diagnostic) {
    element.dataset.diagnosticValue = diagnostic
    element.textContent = diagnostic
  }
}

const observer = new MutationObserver(updateDiagnostics)
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
updateDiagnostics()
