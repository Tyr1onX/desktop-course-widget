import assert from 'node:assert/strict'
import { PresentationClock, validateReplayConfig, withPresentationDate } from '../src/presentation-clock.ts'

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

const realTimestamp = Date.now()
const fixed = new Date(2026, 8, 7, 13, 25)
const rendered = withPresentationDate(fixed, () => ({
  now: new Date(),
  timestamp: Date.now(),
  explicit: new Date(2027, 0, 1, 9, 30),
}))
assert.equal(rendered.now.getTime(), fixed.getTime())
assert.equal(rendered.timestamp, fixed.getTime())
assert.equal(rendered.explicit.getFullYear(), 2027)
assert.equal(rendered.explicit.getHours(), 9)
assert.ok(Math.abs(Date.now() - realTimestamp) < 5_000)

console.log('presentation clock checks passed')
