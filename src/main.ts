import './style.css'
import { createWidget, defaultOptions, type WidgetOptions } from './widget'

type ControlName = keyof WidgetOptions

const app = document.querySelector<HTMLDivElement>('#app')!
let options: WidgetOptions = { ...defaultOptions }

const statuses = [
  ['current', '正在上课'],
  ['between', '课间等待'],
  ['ended', '今日课程结束'],
  ['empty', '今天无课'],
  ['before', '学期尚未开始'],
  ['browsing', '浏览其他日期'],
] as const

const followCounts = [0, 1, 2, 3, 5]

function panelMarkup() {
  return `
    <main class="prototype-shell">
      <section class="stage" aria-label="课表组件预览">
        <div class="stage-label">浏览器视觉原型 <span>150% Windows 缩放 · 浏览器 100%</span></div>
        <div class="wallpaper wallpaper-${options.background}" id="wallpaper">
          <div id="widget-mount"></div>
        </div>
      </section>
      <aside class="debug-panel" aria-label="原型调试台">
        <div class="debug-heading">
          <p class="eyebrow">开发用</p>
          <h1>原型调试台</h1>
          <p>切换状态后立即渲染，无需重新编译。</p>
        </div>
        <fieldset>
          <legend>组件状态</legend>
          <div class="choice-grid status-grid">
            ${statuses.map(([value, label]) => `<button class="choice-button ${options.scenario === value ? 'is-selected' : ''}" type="button" data-control="scenario" data-value="${value}" aria-pressed="${options.scenario === value}">${label}</button>`).join('')}
          </div>
        </fieldset>
        <fieldset>
          <legend>外观</legend>
          <label class="field-label">主题
            <select data-control="theme"><option value="light" ${options.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${options.theme === 'dark' ? 'selected' : ''}>Dark</option></select>
          </label>
          <label class="field-label">桌面背景
            <select data-control="background"><option value="blue" ${options.background === 'blue' ? 'selected' : ''}>蓝色渐变</option><option value="light" ${options.background === 'light' ? 'selected' : ''}>浅色复杂背景</option><option value="dark" ${options.background === 'dark' ? 'selected' : ''}>深色背景</option><option value="colorful" ${options.background === 'colorful' ? 'selected' : ''}>高对比度彩色背景</option></select>
          </label>
          <label class="field-label">组件宽度 <output id="width-output">${options.width} px</output>
            <input type="range" min="340" max="380" value="${options.width}" data-control="width">
          </label>
          <label class="field-label">字体缩放 <output id="scale-output">${Math.round(options.scale * 100)}%</output>
            <input type="range" min="85" max="120" value="${Math.round(options.scale * 100)}" data-control="scale">
          </label>
        </fieldset>
        <fieldset>
          <legend>内容压力测试</legend>
          <label class="switch-row"><input type="checkbox" data-control="longName" ${options.longName ? 'checked' : ''}><span>长课程名</span></label>
          <label class="switch-row"><input type="checkbox" data-control="longLocation" ${options.longLocation ? 'checked' : ''}><span>长地点</span></label>
          <label class="field-label">后续课程数量
            <select data-control="followCount">${followCounts.map((count) => `<option value="${count}" ${options.followCount === count ? 'selected' : ''}>${count}</option>`).join('')}</select>
          </label>
          <label class="switch-row"><input type="checkbox" data-control="showNav" ${options.showNav ? 'checked' : ''}><span>显示日期导航</span></label>
          <label class="field-label">当前时间
            <input type="time" value="${options.time}" data-control="time">
          </label>
        </fieldset>
        <p class="debug-note">调试台不属于最终桌面组件。</p>
      </aside>
    </main>`
}

function render() {
  app.innerHTML = panelMarkup()
  const mount = document.querySelector<HTMLDivElement>('#widget-mount')!
  mount.replaceChildren(createWidget(options, render))

  document.querySelectorAll<HTMLElement>('[data-control]').forEach((control) => {
    control.addEventListener('input', () => updateControl(control))
    control.addEventListener('change', () => updateControl(control))
    control.addEventListener('click', () => {
      if (control instanceof HTMLButtonElement) updateControl(control)
    })
  })
}

function updateControl(control: HTMLElement) {
  const name = control.dataset.control as ControlName
  const value = control.dataset.value ?? (control instanceof HTMLInputElement || control instanceof HTMLSelectElement ? control.value : '')
  if (name === 'width' || name === 'followCount') options[name] = Number(value) as never
  else if (name === 'scale') options.scale = Number(value) / 100
  else if (name === 'longName' || name === 'longLocation' || name === 'showNav') options[name] = (control as HTMLInputElement).checked
  else options[name] = value as never
  render()
}

render()
