import { createWidget, defaultOptions, type WidgetOptions } from '../../../../src/widget'
import { enhanceTimeFlow } from '../../../../src/time-flow'

export type Cleanup = () => void
export type DemoPreset = {
  id: string
  label: string
  scenario: WidgetOptions['scenario']
  time: string
}

export const homepagePresets: DemoPreset[] = [
  { id: 'current', label: '正在上课', scenario: 'current', time: '08:48' },
  { id: 'between', label: '课间等待', scenario: 'between', time: '09:50' },
]

export const experiencePresets: DemoPreset[] = [
  { id: 'current', label: '正在上课', scenario: 'current', time: '08:48' },
  { id: 'between', label: '课间等待', scenario: 'between', time: '09:50' },
  { id: 'ended', label: '今日结束', scenario: 'ended', time: '18:40' },
  { id: 'empty', label: '今天无课', scenario: 'empty', time: '12:20' },
  { id: 'before', label: '学期未开始', scenario: 'before', time: '08:30' },
  { id: 'browsing', label: '浏览日期', scenario: 'browsing', time: '09:50' },
]

export const storyPresets: DemoPreset[] = [
  { id: 'morning', label: '早晨', scenario: 'current', time: '08:12' },
  { id: 'current', label: '此刻', scenario: 'current', time: '08:48' },
  { id: 'ended', label: '结束', scenario: 'ended', time: '18:40' },
]

export const desktopPreset: DemoPreset = {
  id: 'desktop-current',
  label: '桌面运行状态',
  scenario: 'current',
  time: '08:48',
}

export function createButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  return button
}

export function optionsFor(preset: DemoPreset, overrides: Partial<WidgetOptions> = {}): WidgetOptions {
  return {
    ...defaultOptions,
    runtime: 'prototype',
    scenario: preset.scenario,
    theme: 'light',
    background: 'blue',
    width: 360,
    scale: 1,
    followCount: 3,
    showNav: true,
    time: preset.time,
    browsingOffset: 0,
    browseDate: undefined,
    dragRegion: false,
    closeControl: false,
    ...overrides,
  }
}

export function createLatestWidget(
  options: WidgetOptions,
  onNavigate?: () => void,
  extraClass?: string,
): HTMLElement {
  const widget = enhanceTimeFlow(createWidget(options, onNavigate), options)
  widget.classList.add('website-real-widget')
  if (extraClass) widget.classList.add(extraClass)
  return widget
}

export function renderLatestWidget(
  host: HTMLElement,
  options: WidgetOptions,
  onNavigate?: () => void,
  extraClass?: string,
): HTMLElement {
  const widget = createLatestWidget(options, onNavigate, extraClass)
  host.replaceChildren(widget)
  return widget
}
