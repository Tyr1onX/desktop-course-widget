import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const output = path.join(root, '.time-flow-test')
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

try {
  rmSync(output, { recursive: true, force: true })
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.time-flow.json'], { cwd: root, stdio: 'inherit' })
  const helpers = await import(pathToFileURL(path.join(output, 'time-flow.js')).href)

  assert.equal(helpers.minutesFromClock('08:45'), 525)
  assert.equal(helpers.minutesFromClock('24:00'), null)
  assert.equal(helpers.minutesFromClock('8:45'), null)

  assert.equal(helpers.courseProgress(480, 480, 580), 0)
  assert.equal(helpers.courseProgress(530, 480, 580), 0.5)
  assert.equal(helpers.courseProgress(700, 480, 580), 1)
  assert.equal(helpers.courseProgress(500, 580, 480), null)

  assert.equal(helpers.upcomingUrgency(31), 'calm')
  assert.equal(helpers.upcomingUrgency(30), 'soon')
  assert.equal(helpers.upcomingUrgency(10), 'imminent')
  assert.equal(helpers.upcomingUrgency(0), 'imminent')

  assert.equal(helpers.temporalToneForHour(7), 'morning')
  assert.equal(helpers.temporalToneForHour(12), 'day')
  assert.equal(helpers.temporalToneForHour(19), 'evening')
  assert.equal(helpers.temporalToneForHour(23), 'night')
  assert.equal(helpers.temporalToneForHour(-1), 'night')

  console.log('Time-flow checks passed.')
} finally {
  rmSync(output, { recursive: true, force: true })
}
