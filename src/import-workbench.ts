import './import-workbench.css'

const app = document.querySelector<HTMLDivElement>('#app')
let enhanceQueued = false

type ReviewSnapshot = {
  name: string
  meta: string
  state: string
  location: string
}

function text(element: Element | null): string {
  return element?.textContent?.trim() ?? ''
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function reviewSnapshots(root: HTMLElement): ReviewSnapshot[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.import-course-review')).map((card) => ({
    name: text(card.querySelector('.import-course-copy strong')) || '未命名课程',
    meta: text(card.querySelector('.import-course-copy small')),
    state: text(card.querySelector('.import-course-state')),
    location: card.querySelector<HTMLInputElement>('[data-import-field="location"]')?.value.trim() ?? '',
  }))
}

function parsedPreviewMarkup(items: ReviewSnapshot[]): string {
  if (!items.length) {
    return `
      <div class="import-workbench-empty">
        <strong>等待解析</strong>
        <span>选择课表文件后，这里会先展示识别到的课程安排。</span>
      </div>
    `
  }

  const visible = items.slice(0, 6)
  return `
    <div class="import-preview-list" aria-label="解析预览">
      ${visible.map((item) => `
        <div class="import-preview-row">
          <span class="import-preview-course">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.meta)}</small>
          </span>
          <span class="import-preview-state${item.state.includes('待确认') ? ' is-review' : ''}">${escapeHtml(item.state || '已解析')}</span>
        </div>
      `).join('')}
      ${items.length > visible.length ? `<div class="import-preview-more">另有 ${items.length - visible.length} 项，在下方逐项检查</div>` : ''}
    </div>
  `
}

function resultPreviewMarkup(items: ReviewSnapshot[]): string {
  if (!items.length) {
    return `
      <div class="import-result-widget is-empty">
        <div class="import-result-widget-header"><strong>课刻</strong><span>--:--</span></div>
        <div class="import-result-placeholder">解析完成后预览桌面呈现</div>
      </div>
    `
  }

  const [focus, ...following] = items
  return `
    <div class="import-result-widget" aria-label="导入后课刻预览">
      <div class="import-result-widget-header"><strong>课刻</strong><span>09:55</span></div>
      <div class="import-result-date">导入后的课表 · 桌面组件预览</div>
      <section class="import-result-focus">
        <span>当前 / 下一节</span>
        <strong>${escapeHtml(focus.name)}</strong>
        <small>${escapeHtml(focus.meta)}</small>
        ${focus.location ? `<small>${escapeHtml(focus.location)}</small>` : ''}
      </section>
      ${following.length ? `
        <div class="import-result-following">
          <span>后续课程</span>
          ${following.slice(0, 3).map((item) => `<div><i></i><strong>${escapeHtml(item.name)}</strong></div>`).join('')}
        </div>
      ` : ''}
      <div class="import-result-footer"><span>本地课表</span><span>导入后可继续编辑</span></div>
    </div>
  `
}

function panel(title: string, subtitle: string, className: string): HTMLElement {
  const section = document.createElement('section')
  section.className = `import-workbench-panel ${className}`
  section.innerHTML = `
    <header class="import-workbench-panel-heading">
      <div><strong>${title}</strong><span>${subtitle}</span></div>
    </header>
  `
  return section
}

function refreshGeneratedPreviews(root: HTMLElement): void {
  const items = reviewSnapshots(root)
  const compactPreview = root.querySelector<HTMLElement>('.import-compact-preview')
  const resultPreview = root.querySelector<HTMLElement>('.import-result-preview')
  const parsedMarkup = parsedPreviewMarkup(items)
  const resultMarkup = resultPreviewMarkup(items)

  if (compactPreview && compactPreview.dataset.snapshot !== parsedMarkup) {
    compactPreview.dataset.snapshot = parsedMarkup
    compactPreview.innerHTML = parsedMarkup
  }
  if (resultPreview && resultPreview.dataset.snapshot !== resultMarkup) {
    resultPreview.dataset.snapshot = resultMarkup
    resultPreview.innerHTML = resultMarkup
  }
}

function enhanceImportWorkbench(): void {
  enhanceQueued = false
  const root = app?.querySelector<HTMLElement>('.import-review-surface')
  if (!root) return

  const existingWorkbench = root.querySelector<HTMLElement>('.import-workbench-grid')
  if (existingWorkbench) {
    refreshGeneratedPreviews(root)
    return
  }

  const surface = root.closest<HTMLElement>('.side-surface')
  if (!surface) return

  root.dataset.workbenchEnhanced = 'true'
  surface.classList.add('side-surface--import-vnext')

  const intro = root.querySelector<HTMLElement>('.surface-intro')
  const picker = root.querySelector<HTMLElement>('.import-picker')
  const summary = root.querySelector<HTMLElement>('.import-summary')
  const basics = root.querySelector<HTMLElement>('.import-basics')
  const warnings = root.querySelector<HTMLElement>('.import-parser-warnings, .import-structured-warnings')
  const reviewHeading = root.querySelector<HTMLElement>('.import-review-heading')
  const reviewList = root.querySelector<HTMLElement>('.import-review-list')
  const message = root.querySelector<HTMLElement>('.surface-message')
  const items = reviewSnapshots(root)

  const workbench = document.createElement('div')
  workbench.className = 'import-workbench-grid'

  const sourcePanel = panel(
    picker ? '1 · 选择课表' : '1 · 课表信息',
    picker ? '文件仅在本机解析' : '确认名称与第一教学周',
    'import-source-panel',
  )
  if (intro) sourcePanel.append(intro)
  if (picker) sourcePanel.append(picker)
  if (basics) sourcePanel.append(basics)

  const previewPanel = panel('2 · 解析预览', '先看整体，再处理异常', 'import-preview-panel')
  if (summary) previewPanel.append(summary)
  const compactPreview = document.createElement('div')
  compactPreview.className = 'import-compact-preview'
  const parsedMarkup = parsedPreviewMarkup(items)
  compactPreview.dataset.snapshot = parsedMarkup
  compactPreview.innerHTML = parsedMarkup
  previewPanel.append(compactPreview)
  if (warnings) previewPanel.append(warnings)

  const resultPanel = panel('3 · 导入后', '确认前先看最终形态', 'import-result-panel')
  const resultPreview = document.createElement('div')
  resultPreview.className = 'import-result-preview'
  const resultMarkup = resultPreviewMarkup(items)
  resultPreview.dataset.snapshot = resultMarkup
  resultPreview.innerHTML = resultMarkup
  resultPanel.append(resultPreview)

  workbench.append(sourcePanel, previewPanel, resultPanel)
  root.prepend(workbench)

  if (reviewHeading || reviewList) {
    const reviewSection = document.createElement('section')
    reviewSection.className = 'import-review-workbench-section'
    if (reviewHeading) reviewSection.append(reviewHeading)
    if (reviewList) reviewSection.append(reviewList)
    root.insertBefore(reviewSection, message ?? null)
  }
}

function queueEnhance(): void {
  if (enhanceQueued) return
  enhanceQueued = true
  window.requestAnimationFrame(enhanceImportWorkbench)
}

if (app) {
  new MutationObserver(queueEnhance).observe(app, { childList: true, subtree: true })
  queueEnhance()
}
