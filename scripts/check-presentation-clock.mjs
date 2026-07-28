import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PresentationClock, validateReplayConfig } from '../src/presentation-clock.ts'

const config = {
  date: '2026-09-07',
  start: '08:00',
  end: '22:00',
  durationSeconds: 14,
  loop: false,
}

validateReplayConfig(config)
const clock = new PresentationClock()
let snapshot = clock.start(config, 1_000)
assert.equal(snapshot.date.getHours(), 8)
assert.equal(snapshot.date.getMinutes(), 0)
assert.equal(snapshot.playing, true)

snapshot = clock.snapshot(8_000)
assert.equal(snapshot.progress, 0.5)
assert.equal(snapshot.date.getHours(), 15)
assert.equal(snapshot.date.getMinutes(), 0)

snapshot = clock.pause(8_000)
assert.equal(snapshot.playing, false)
assert.equal(clock.snapshot(20_000).progress, 0.5)

snapshot = clock.resume(20_000)
assert.equal(snapshot.playing, true)
snapshot = clock.snapshot(27_000)
assert.equal(snapshot.finished, true)
assert.equal(snapshot.playing, false)
assert.equal(snapshot.date.getHours(), 22)
assert.equal(snapshot.date.getMinutes(), 0)

assert.throws(() => validateReplayConfig({ ...config, end: '07:00' }), /结束时间必须晚于开始时间/)
assert.throws(() => validateReplayConfig({ ...config, durationSeconds: 2 }), /3–300 秒/)

const looping = new PresentationClock()
looping.start({ ...config, durationSeconds: 10, loop: true }, 0)
snapshot = looping.snapshot(12_500)
assert.equal(snapshot.finished, false)
assert.equal(snapshot.progress, 0.25)
assert.equal(snapshot.date.getHours(), 11)
assert.equal(snapshot.date.getMinutes(), 30)

const widgetSource = readFileSync(new URL('../src/widget.ts', import.meta.url), 'utf8')
const widgetPageSource = readFileSync(new URL('../src/widget-page.ts', import.meta.url), 'utf8')
const widgetPageCss = readFileSync(new URL('../src/widget-page.css', import.meta.url), 'utf8')
const controllerSource = readFileSync(new URL('../src/presentation-page.ts', import.meta.url), 'utf8')
const tauriConfig = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')

assert.match(widgetSource, /now\?: Date/)
assert.match(widgetSource, /const now = options\.now \? new Date\(options\.now\) : new Date\(\)/)
assert.match(widgetSource, /const today = startOfDay\(options\.now \?\? new Date\(\)\)/)
assert.match(widgetPageSource, /options\.now = snapshot\.date/)
assert.match(widgetPageSource, /WebviewWindow\.getByLabel\('presentation'\)/)
assert.match(widgetPageSource, /PRESENTATION_COMMAND_EVENT/)
assert.match(controllerSource, /PRESENTATION_STATUS_REQUEST_EVENT/)
assert.match(controllerSource, /录制时只捕获课刻窗口/)
assert.match(widgetPageCss, /::view-transition-old\(replay-focus-course\)/)
assert.match(tauriConfig, /"label": "presentation"/)
assert.doesNotMatch(widgetPageSource, /presentation-panel/)
assert.doesNotMatch(widgetPageSource, /withPresentationDate/)

console.log('presentation clock, controller, and widget wiring checks passed')
