import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/screenshot-import-controller.ts', import.meta.url), 'utf8')

test('file-dialog waiting is distinct from OCR recognition time', () => {
  const chooseStart = source.indexOf('async function chooseScreenshot')
  const chooseEnd = source.indexOf('function renderReviewSurface', chooseStart)
  const chooseSource = source.slice(chooseStart, chooseEnd)
  const watchStart = source.indexOf('function watchNativeDialog')
  const watchEnd = source.indexOf('async function chooseScreenshot', watchStart)
  const watchSource = source.slice(watchStart, watchEnd)

  assert.ok(chooseStart >= 0)
  assert.ok(chooseSource.indexOf('watchNativeDialog(surface)') < chooseSource.indexOf("invoke<ImportDraft | null>('choose_and_parse_screenshot')"))
  assert.doesNotMatch(
    chooseSource.slice(0, chooseSource.indexOf("invoke<ImportDraft | null>('choose_and_parse_screenshot')")),
    /setRecognitionBusy\(surface, true\)/,
    'opening the native file dialog must not start the OCR timer',
  )
  assert.match(watchSource, /if \(!selectionPending \|\| !focusLeftWindow\) return/)
  assert.match(watchSource, /setRecognitionBusy\(surface, true\)/)
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
