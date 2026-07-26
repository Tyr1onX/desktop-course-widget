import './style.css'
import './time-flow.css'
import { enhanceTimeFlow } from './time-flow'
import { createWidget, defaultOptions, type WidgetOptions } from './widget'

const app = document.querySelector<HTMLDivElement>('#app')!
const cases: Array<{ title: string; description: string; options: Partial<WidgetOptions> }> = [
  { title: '正在上课', description: '时间轨迹随着课程推进。', options: { scenario: 'current', followCount: 3 } },
  { title: '课间等待', description: '临近上课时自然增强提示。', options: { scenario: 'between', followCount: 2 } },
  { title: '今日结束', description: '紧凑呈现下一次真正有课。', options: { scenario: 'ended' } },
  { title: '今天无课', description: '没有填充性空白。', options: { scenario: 'empty' } },
  { title: '学期尚未开始', description: '保留下一次课的信息。', options: { scenario: 'before' } },
  { title: '浏览其他日期', description: '实时倒计时与进度保持隐藏。', options: { scenario: 'browsing', followCount: 2 } },
  { title: '长课程名', description: '中文自然换行。', options: { scenario: 'current', longName: true, followCount: 1 } },
  { title: '长地点', description: '地点不溢出。', options: { scenario: 'between', longLocation: true, followCount: 1 } },
  { title: '1 条后续课程', description: '最小时间轴。', options: { scenario: 'current', followCount: 1 } },
  { title: '2 条后续课程', description: '自然增高。', options: { scenario: 'current', followCount: 2 } },
  { title: '3 条后续课程', description: '完整时间轴。', options: { scenario: 'current', followCount: 3 } },
  { title: '5 条后续课程', description: '三条后提示剩余数量。', options: { scenario: 'current', followCount: 5 } },
]

app.innerHTML = `<main class="gallery-page"><header class="gallery-header"><div><p class="eyebrow">组件验收页面</p><h1>课表组件 Gallery</h1><p>同一套设计系统在不同状态和内容压力下的真实渲染。</p></div><a href="/">返回调试台</a></header><section class="gallery-grid">${cases.map((item, index) => `<article class="gallery-case"><header><h2>${item.title}</h2><p>${item.description}</p></header><div id="gallery-widget-${index}" class="gallery-widget-mount"></div></article>`).join('')}</section></main>`

cases.forEach((item, index) => {
  const options = { ...defaultOptions, ...item.options }
  document.querySelector(`#gallery-widget-${index}`)?.append(enhanceTimeFlow(createWidget(options), options))
})
