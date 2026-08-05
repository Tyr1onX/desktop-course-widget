import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
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

function permissionIdentifier(permission) {
  return typeof permission === 'string' ? permission : permission.identifier
}

function permissionIdentifiers(capability) {
  return capability.permissions.map(permissionIdentifier)
}

function permissionEntry(capability, identifier) {
  return capability.permissions.find((permission) => permissionIdentifier(permission) === identifier)
}

function hasPermission(capability, identifier) {
  return permissionIdentifiers(capability).includes(identifier)
}

function assertPermissionAbsent(capability, permissions) {
  const identifiers = permissionIdentifiers(capability)
  for (const permission of permissions) {
    assert(!identifiers.includes(permission), `${capability.identifier} must not include ${permission}`)
  }
}

function scopedLabels(capability, identifier) {
  const entry = permissionEntry(capability, identifier)
  assert(entry && typeof entry === 'object', `${capability.identifier} ${identifier} must be scoped`)
  return (entry.allow ?? []).map((scope) => scope.label)
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}

function frontendSourceFiles() {
  const supported = new Set(['.ts', '.tsx', '.js', '.mjs', '.html'])
  return walkFiles(join(root, 'src')).filter((path) => supported.has(extname(path)))
}

function commandNamesFromSource(source) {
  return [...source.matchAll(/#\[tauri::command(?:\([^\]]*\))?\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)/g)]
    .map((match) => match[1])
}

function handlerCommandNames(source) {
  const match = /generate_handler!\s*\[([\s\S]*?)\]\s*\)/.exec(source)
  assert(match, 'invoke_handler must use generate_handler with an explicit command list')
  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.split('::').at(-1))
}

test('application commands are registered, manifested, and assigned without omissions', () => {
  const lib = read('src-tauri/src/lib.rs')
  const windowCommands = read('src-tauri/src/window_commands.rs')
  const build = read('src-tauri/build.rs')
  const declared = [...commandNamesFromSource(lib), ...commandNamesFromSource(windowCommands)]
  const handled = handlerCommandNames(lib)
  const manifested = extractRustStringArray(build, 'APP_COMMANDS')

  assert.deepEqual(sorted(handled), sorted(declared), 'every #[tauri::command] must be in invoke_handler')
  assert.deepEqual(sorted(manifested), sorted(handled), 'every invoke_handler command must be in AppManifest')
  assert(build.includes('.app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS))'))

  const assignedPermissions = new Set(capabilities.flatMap(permissionIdentifiers))
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

  assert(
    !permissionIdentifiers(main).some((permission) => permission.startsWith('core:window:')),
    'main must not expose generic core window commands',
  )
  for (const permission of [
    'allow-read-schedule',
    'allow-read-app-settings',
    'core:event:default',
    'allow-open-presentation-controller',
    'allow-configure-main-widget',
    'allow-resize-main-widget',
    'allow-show-main-widget',
    'allow-hide-main-widget',
    'allow-start-main-widget-drag',
  ]) {
    assert(hasPermission(main, permission), `main is missing ${permission}`)
  }

  assert(hasPermission(presentation, 'allow-read-schedule'))
  assert(hasPermission(presentation, 'core:event:default'))
  assert.deepEqual(scopedLabels(presentation, 'core:window:allow-hide'), ['presentation'])
  assert(!hasPermission(presentation, 'allow-open-presentation-controller'))

  assert.deepEqual(scopedLabels(settings, 'core:window:allow-hide'), ['settings'])
  assert(!hasPermission(settings, 'dialog:default'), 'settings must not expose the frontend dialog plugin')
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
  ]) {
    assert(hasPermission(settings, permission), `settings is missing ${permission}`)
  }

  assert.match(main.description, /only its own window/i)
  assert.match(main.description, /hard-coded presentation controller/i)
  assert.match(settings.description, /backend-owned/i)
  assert.match(presentation.description, /only its own scoped window/i)

  for (const capability of capabilities) {
    assert(!permissionIdentifiers(capability).some((permission) => /allow[-_:]?all/i.test(permission)))
  }
})

test('presentation controller opening is hard-coded and source validated', () => {
  const source = read('src-tauri/src/window_commands.rs')
  const main = capabilityByWindow.get('main')
  const settings = capabilityByWindow.get('settings')
  const presentation = capabilityByWindow.get('presentation')
  assert(main && settings && presentation)

  assert(source.includes('const MAIN_WINDOW_LABEL: &str = "main";'))
  assert(source.includes('const PRESENTATION_WINDOW_LABEL: &str = "presentation";'))

  const signature = /pub fn open_presentation_controller\s*\(([^)]*)\)/.exec(source)
  assert(signature, 'open_presentation_controller must exist as a Rust command')
  assert.match(signature[1], /window:\s*tauri::WebviewWindow/)
  assert(!/label|target|String|&str/.test(signature[1]), 'command must not accept an arbitrary target label')

  const start = source.indexOf('pub fn open_presentation_controller')
  const end = source.indexOf('#[tauri::command]', start + 1)
  const body = source.slice(start, end)
  assert(body.includes('require_window_label(&window, MAIN_WINDOW_LABEL)?'))
  assert(body.includes('get_webview_window(PRESENTATION_WINDOW_LABEL)'))
  assert(body.includes('controller.show()'))
  assert(body.includes('controller.set_focus()'))

  const holders = capabilities
    .filter((capability) => hasPermission(capability, 'allow-open-presentation-controller'))
    .map((capability) => capability.identifier)
  assert.deepEqual(holders, ['main-widget'])
  assert(!hasPermission(settings, 'allow-open-presentation-controller'))
  assert(!hasPermission(presentation, 'allow-open-presentation-controller'))
})

test('main window application commands bind operations to the calling main window', () => {
  const source = read('src-tauri/src/window_commands.rs')
  for (const command of [
    'configure_main_widget',
    'resize_main_widget',
    'show_main_widget',
    'hide_main_widget',
    'start_main_widget_drag',
  ]) {
    const start = source.indexOf(`pub fn ${command}`)
    assert(start >= 0, `${command} must exist`)
    const end = source.indexOf('#[tauri::command]', start + 1)
    const body = source.slice(start, end < 0 ? source.length : end)
    assert(body.includes('window: tauri::WebviewWindow'), `${command} must use injected caller context`)
    assert(body.includes('require_window_label(&window, MAIN_WINDOW_LABEL)?'), `${command} must reject non-main callers`)
  }

  assert(source.includes('const MAIN_WINDOW_WIDTH: f64 = 392.0;'))
  assert(source.includes('const MAIN_WINDOW_MIN_HEIGHT: f64 = 160.0;'))
  assert(source.includes('const MAIN_WINDOW_MAX_HEIGHT: f64 = 740.0;'))
  assert(source.includes('height.is_finite()'))
  assert(source.includes('(MAIN_WINDOW_MIN_HEIGHT..=MAIN_WINDOW_MAX_HEIGHT).contains(&height)'))
  assert(!/pub fn resize_main_widget[\s\S]*?label\s*:/.test(source))
})

test('main frontend has no generic cross-window control path', () => {
  const page = read('src/widget-page.ts')
  const shell = read('src/desktop-shell.ts')
  const widget = read('src/widget.ts')

  assert(!page.includes('WebviewWindow'))
  assert(!page.includes('getByLabel'))
  assert(page.includes("invoke('open_presentation_controller')"))

  for (const marker of [
    '.show(',
    '.hide(',
    '.setFocus(',
    '.setSize(',
    '.setMinSize(',
    '.setMaxSize(',
    '.scaleFactor(',
    '.startDragging(',
  ]) {
    assert(!shell.includes(marker), `desktop shell must not call generic window method ${marker}`)
  }
  assert(shell.includes("invoke<MainWindowMetrics>('resize_main_widget'"))
  assert(shell.includes("invoke('configure_main_widget')"))
  assert(shell.includes("invoke('show_main_widget')"))
  assert(shell.includes('appWindow.onScaleChanged'), 'DPI change behavior must remain event-driven')

  assert(!widget.includes('getCurrentWindow'))
  assert(widget.includes("invoke('hide_main_widget')"))
  assert(widget.includes("invoke('start_main_widget_drag')"))
})

test('frontend does not use the dialog plugin directly', () => {
  const violations = []
  for (const path of frontendSourceFiles()) {
    const source = readFileSync(path, 'utf8')
    if (source.includes('@tauri-apps/plugin-dialog') || source.includes('plugin:dialog|')) {
      violations.push(relative(root, path))
    }
  }
  assert.deepEqual(violations, [], `frontend dialog usage requires a narrow permission: ${violations.join(', ')}`)
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
    './scripts/windows-window-smoke.ps1',
    'git diff --exit-code',
  ]) {
    assert(workflow.includes(command), `release workflow is missing ${command}`)
  }
})
