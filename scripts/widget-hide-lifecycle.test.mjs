import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const widgetSource = readFileSync(new URL('../src/widget.ts', import.meta.url), 'utf8')

function mainWidgetHideHandler(source) {
  const start = source.indexOf("widget.querySelector<HTMLButtonElement>('[data-hide]')")
  assert(start >= 0, 'main widget hide handler must exist')
  const end = source.indexOf('\n\n  const dragSurface', start)
  assert(end > start, 'main widget hide handler must end before drag setup')
  return source.slice(start, end)
}

test('main widget hide guard is released after both successful and failed requests', () => {
  const handler = mainWidgetHideHandler(widgetSource)

  assert.match(handler, /if \(hideRequested \|\| !isTauri\(\)\) return/)
  assert.match(handler, /hideRequested = true/)
  assert.match(handler, /invoke\('hide_main_widget'\)/)
  assert.match(handler, /\.catch\(\(error: unknown\) => \{[\s\S]*?console\.error\('\[widget-close\] hide failed', error\)[\s\S]*?\}\)/)
  assert.match(handler, /\.finally\(\(\) => \{[\s\S]*?hideRequested = false[\s\S]*?\}\)/)

  const catchBlock = /\.catch\(\(error: unknown\) => \{([\s\S]*?)\}\)/.exec(handler)?.[1] ?? ''
  assert(!catchBlock.includes('hideRequested = false'), 'request state must have one shared finally reset')
})
