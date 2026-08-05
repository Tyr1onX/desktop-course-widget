import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve('.')
const read = (path) => readFileSync(join(root, path), 'utf8')
const readJson = (path) => JSON.parse(read(path))

const capabilityDirectory = join(root, 'src-tauri/capabilities')
const capabilities = readdirSync(capabilityDirectory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => readJson(`src-tauri/capabilities/${name}`))
const capabilityByWindow = new Map(
  capabilities.flatMap((capability) => capability.windows.map((window) => [window, capability])),
)

function extractRustStringArray(source, constantName) {
  const match = new RegExp(`const\\s+${constantName}[^=]*=\\s*&\\[([\\s\\S]*?)\\];`).exec(source)
  assert(match, `${constantName} must be declared as a static Rust string array`)
  return [...match[1].matchAll(/"([a-z0-9_:-]+)"/g)].map((item) => item[1])
}

function sorted(values) {
  return [...values].sort()
}

function permissionForAppCommand(command) {
  return `allow-${command.replaceAll('_', '-')}`
}

function assertPermissionAbsent(capability, permissions) {
  for (const permission of permissions) {
    assert(!capability.permissions.includes(permission), `${capability.identifier} must not include ${permission}`)
  }
}

test('application commands are registered, manifested, and assigned without omissions', () => {
  const lib = read('src-tauri/src/lib.rs')
  const build = read('src-tauri/build.rs')
  const declared = [...lib.matchAll(/#\[tauri::command(?:\([^\]]*\))?\]\s*(?:async\s+)?fn\s+([a-z0-9_]+)/g)]
    .map((match) => match[1])
  const handlerMatch = /generate_handler!\s*\[([\s\S]*?)\]\s*\)/.exec(lib)
  assert(handlerMatch, 'invoke_handler must use generate_handler with an explicit command list')
  const handled = handlerMatch[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const manifested = extractRustStringArray(build, 'APP_COMMANDS')

  assert.deepEqual(sorted(handled), sorted(declared), 'every #[tauri::command] must be in invoke_handler')
  assert.deepEqual(sorted(manifested), sorted(handled), 'every invoke_handler command must be in AppManifest')
  assert(build.includes('.app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS))'))

  const assignedPermissions = new Set(capabilities.flatMap((capability) => capability.permissions))
  for (const command of manifested) {
    assert(
      assignedPermissions.has(permissionForAppCommand(command)),
      `application command ${command} has no capability permission assignment`,
    )
  }
})

test('each window has one capability with the intended responsibility boundary', () => {
  assert.deepEqual(sorted([...capabilityByWindow.keys()]), ['main', 'presentation', 'settings'])
  assert.equal(capabilities.flatMap((capability) => capability.windows).length, 3)

  const main = capabilityByWindow.get('main')
  const settings = capabilityByWindow.get('settings')
  const presentation = capabilityByWindow.get('presentation')
  assert(main && settings && presentation)

  const writeAndImportPermissions = [
    'allow-save-lesson-times',
    'allow-choose-and-parse-excel',
    'allow-choose-and-parse-screenshot',
    'allow-apply-imported-schedule',
    'dialog:default',
    'schedule-catalog:allow-update-schedule',
    'schedule-catalog:allow-activate-schedule',
    'schedule-catalog:allow-delete-schedule',
    'schedule-catalog:allow-create-schedule-from-import',
    'schedule-catalog:allow-save-course',
    'schedule-catalog:allow-delete-course',
    'schedule-catalog:allow-set-autostart',
    'schedule-catalog:allow-open-data-location',
  ]
  assertPermissionAbsent(main, writeAndImportPermissions)
  assertPermissionAbsent(presentation, writeAndImportPermissions)

  for (const permission of [
    'allow-read-schedule',
    'allow-read-app-settings',
    'core:event:default',
    'core:window:allow-show',
    'core:window:allow-hide',
    'core:window:allow-start-dragging',
  ]) {
    assert(main.permissions.includes(permission), `main is missing ${permission}`)
  }

  assert(presentation.permissions.includes('allow-read-schedule'))
  assert(presentation.permissions.includes('core:event:default'))
  assert(presentation.permissions.includes('core:window:allow-hide'))

  for (const permission of [
    'allow-read-schedule',
    'allow-read-app-settings',
    'allow-get-runtime-capabilities',
    'allow-save-lesson-times',
    'allow-choose-and-parse-excel',
    'allow-choose-and-parse-screenshot',
    'schedule-catalog:allow-delete-schedule',
    'schedule-catalog:allow-create-schedule-from-import',
    'schedule-catalog:allow-set-autostart',
    'schedule-catalog:allow-open-data-location',
    'dialog:default',
  ]) {
    assert(settings.permissions.includes(permission), `settings is missing ${permission}`)
  }

  for (const capability of capabilities) {
    assert(!capability.permissions.some((permission) => /allow[-_:]?all/i.test(permission)))
  }
})

test('release screenshot backend has a compile-time debug boundary', () => {
  const source = read('src-tauri/src/screenshot_import.rs')
  const debugModule = '#[cfg(debug_assertions)]\nmod development_runtime'
  const moduleIndex = source.indexOf(debugModule)
  assert(moduleIndex >= 0, 'development OCR implementation must be a cfg-gated module')
  assert(!source.includes('cfg!(debug_assertions)'), 'dangerous OCR paths must not use runtime cfg checks')
  assert(source.includes('#[cfg(not(debug_assertions))]\npub fn recognize_screenshot'))

  for (const marker of [
    'COURSE_WIDGET_OCR_PYTHON',
    'COURSE_WIDGET_OCR_REPO_ROOT',
    'Command::new',
    'experiments.screenshot_import',
  ]) {
    assert(source.indexOf(marker) > moduleIndex, `${marker} must only exist inside the debug-gated module`)
  }
})

test('CSP permits only packaged assets and Tauri local IPC schemes', () => {
  const config = readJson('src-tauri/tauri.conf.json')
  const csp = config.app?.security?.csp
  assert(csp && typeof csp === 'object', 'CSP must be enabled as a directive map')

  const serialized = JSON.stringify(csp)
  assert(!serialized.includes('*'), 'CSP must not contain wildcard sources')
  assert(!serialized.includes("'unsafe-eval'"), 'CSP must not allow unsafe-eval')
  assert.equal(csp['script-src'], "'self'")
  assert.equal(csp['connect-src'], 'ipc: http://ipc.localhost')
  assert.equal(csp['object-src'], "'none'")
  assert.equal(csp['frame-src'], "'none'")
  assert(!/https:\/\//.test(serialized), 'CSP must not allow remote HTTPS origins')

  const windows = config.app.windows.map(({ label, url }) => ({ label, url }))
  assert.deepEqual(windows, [
    { label: 'main', url: 'widget.html' },
    { label: 'settings', url: 'settings.html' },
    { label: 'presentation', url: 'presentation.html' },
  ])
})

test('release workflow is read-only, locked, reproducible, and leaves the tree clean', () => {
  const workflow = read('.github/workflows/release-build.yml')
  assert(/permissions:\s*\n\s*contents:\s*read/.test(workflow))
  assert(!/contents:\s*write/.test(workflow))
  assert(!/git\s+(?:add|commit|push)\b/i.test(workflow))
  assert(!/npm install\s+--package-lock-only/i.test(workflow))
  assert(!/cargo\s+(?:update|generate-lockfile)\b/i.test(workflow))

  for (const command of [
    'npm ci',
    'cargo check --locked --manifest-path src-tauri/Cargo.toml',
    'cargo check --release --locked --manifest-path src-tauri/Cargo.toml',
    'cargo test --locked --manifest-path src-tauri/Cargo.toml --lib',
    'npm run check:version',
    'npm run check:time-flow',
    'npm run check:import-review',
    'npm run check:screenshot-import',
    'npm run check:import-review-dom',
    'npm run check:screenshot-import-dom',
    'npm run check:presentation-clock',
    'npm run check:security-boundary',
    'npm run web:build',
    'npm run tauri:build',
    'git diff --exit-code',
  ]) {
    assert(workflow.includes(command), `release workflow is missing ${command}`)
  }
})
