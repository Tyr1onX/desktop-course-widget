import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canUseScreenshotImport,
  conservativeRuntimeCapabilities,
  normalizeRuntimeCapabilities,
  readRuntimeCapabilities,
} from '../src/runtime-capabilities.ts'

test('accepts an explicit screenshot runtime capability', () => {
  const capabilities = normalizeRuntimeCapabilities({
    platform: 'windows',
    screenshotImport: {
      available: true,
      backend: 'rust-native',
      unavailableReason: null,
    },
  })

  assert.equal(capabilities.platform, 'windows')
  assert.equal(capabilities.screenshotImport.backend, 'rust-native')
  assert.equal(canUseScreenshotImport(capabilities), true)
})

test('keeps an explicit unavailable result unavailable', () => {
  const capabilities = normalizeRuntimeCapabilities({
    platform: 'windows',
    screenshotImport: {
      available: false,
      backend: 'none',
      unavailableReason: 'release bundle has no OCR runtime',
    },
  })

  assert.equal(canUseScreenshotImport(capabilities), false)
  assert.equal(capabilities.screenshotImport.unavailableReason, 'release bundle has no OCR runtime')
})

test('rejects malformed available capabilities without a backend', () => {
  const capabilities = normalizeRuntimeCapabilities({
    platform: 'windows',
    screenshotImport: { available: true },
  })

  assert.deepEqual(capabilities, conservativeRuntimeCapabilities)
  assert.equal(canUseScreenshotImport(capabilities), false)
})

test('capability read failure conservatively disables screenshot import', async () => {
  const capabilities = await readRuntimeCapabilities(async () => {
    throw new Error('IPC unavailable')
  })

  assert.deepEqual(capabilities, conservativeRuntimeCapabilities)
  assert.equal(canUseScreenshotImport(capabilities), false)
})
