import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/screenshot-import-controller.ts', import.meta.url), 'utf8')

test('file-dialog waiting is distinct from OCR recognition time', () => {
  const chooseStart = source.indexOf('async function chooseScreenshot')
  const invokeIndex = source.indexOf("invoke<ImportDraft | null>('choose_and_parse_screenshot')", chooseStart)
  const watchIndex = source.indexOf('watchNativeDialog(surface)', chooseStart)
  const recognitionStart = source.indexOf('setRecognitionBusy(surface, true)', chooseStart)

  assert.ok(chooseStart >= 0)
  assert.ok(watchIndex > chooseStart && watchIndex < invokeIndex)
  assert.ok(recognitionStart > invokeIndex, 'recognition busy state must begin only after the native dialog returns focus')
  assert.match(source, /if \(!selectionPending \|\| !focusLeftWindow\) return/)
  assert.match(source, /recognitionStartedAt = performance\.now\(\)/)
  assert.match(source, /window\.setInterval\(tick, 1000\)/)
  assert.match(source, /正在识别课表 · \$\{elapsedSeconds\} 秒/)
})

test('OCR recognition locks and restores the complete settings surface', () => {
  assert.match(source, /querySelectorAll<LockableControl>\('button, input, select, textarea'\)/)
  assert.match(source, /control\.dataset\.screenshotOcrWasDisabled = control\.disabled \? 'true' : 'false'/)
  assert.match(source, /control\.disabled = true/)
  assert.match(source, /control\.disabled = previous === 'true'/)
  assert.match(source, /delete control\.dataset\.screenshotOcrWasDisabled/)
  assert.match(source, /if \(currentSurface && recognitionPending\) setRecognitionBusy\(currentSurface, false\)/)
  assert.match(source, /else stopRecognitionClock\(\)/)
})
