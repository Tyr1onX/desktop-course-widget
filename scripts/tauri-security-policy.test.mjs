import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import {
  hidePresentationWindowOnClose,
  requestSettingsWindowClose,
} from '../src/window-close-behavior.ts'

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

function hasPermission(capability, identifier) {
  return permissionIdentifiers(capability).includes(identifier)
}

function assertPermissionAbsent(capability, permissions) {
  const identifiers = permissionIdentifiers(capability)
  for (const permission of permissions) {
    assert(!identifiers.includes(permission), `${capability.identifier} must not include ${permission}`)
  }
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

function commandBlock(source, command) {
  const start = source.indexOf(`pub fn ${command}`)
  assert(start >= 0, `${command} must exist`)
  const end = source.indexOf('#[tauri::command]', start + 1)
  return source.slice(start, end < 0 ? source.length : end)
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

test('each window has one capability and no capability exposes core window control commands', () => {
  assert.deepEqual(sorted([...capabilityByWindow.keys()]), ['main', 'presentation', 'settings'])
  assert.equal(capabilities.flatMap((capability) => capability.windows).length, 3)

  const main = capabilityByWindow.get('main')
  const settings = capabilityByWindow.get('settings')
  const presentation = capabilityByWindow.get('presentation')
  assert(main && settings && presentation)

  for (const capability of capabilities) {
    const coreWindowPermissions = permissionIdentifiers(capability)
      .filter((permission) => permission.startsWith('core:window:'))
    assert.deepEqual(
      coreWindowPermissions,
      [],
      `${capability.identifier} must not expose any generic core window command`,
    )
    assert(!permissionIdentifiers(capability).some((permission) => /allow[-_:]?all/i.test(permission)))
  }

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
    'allow-open-presentation-controller',
    'allow-configure-main-widget',
    'allow-resize-main-widget',
    'allow-show-main-widget',
    'allow-hide-main-widget',
    'allow-start-main-widget-drag',
  ]) {
    assert(hasPermission(main, permission), `main is missing ${permission}`)
  }
  assertPermissionAbsent(main, [
    'allow-hide-settings-window',
    'allow-hide-presentation-window',
  ])

  assert(hasPermission(presentation, 'allow-read-schedule'))
  assert(hasPermission(presentation, 'core:event:default'))
  assert(hasPermission(presentation, 'allow-hide-presentation-window'))
  assertPermissionAbsent(presentation, [
    'allow-hide-settings-window',
    'allow-open-presentation-controller',
  ])

  assert(hasPermission(settings, 'allow-hide-settings-window'))
  assertPermissionAbsent(settings, [
    'allow-hide-presentation-window',
    'dialog:default',
    'allow-open-presentation-controller',
  ])
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
  assert.match(settings.description, /hide only itself through a source-validated application command/i)
  assert.match(settings.description, /backend-owned/i)
  assert.match(presentation.description, /hide only itself through a source-validated application command/i)
  assert.doesNotMatch(settings.description, /scoped core|label scope/i)
  assert.doesNotMatch(presentation.description, /scoped core|label scope/i)
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

  const body = commandBlock(source, 'open_presentation_controller')
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
    const body = commandBlock(source, command)
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

test('settings and presentation hide commands operate only on their injected caller window', () => {
  const source = read('src-tauri/src/window_commands.rs')
  const specifications = [
    {
      command: 'hide_settings_window',
      labelConstant: 'SETTINGS_WINDOW_LABEL',
      labelDeclaration: 'const SETTINGS_WINDOW_LABEL: &str = "settings";',
      permission: 'allow-hide-settings-window',
      capability: 'settings',
    },
    {
      command: 'hide_presentation_window',
      labelConstant: 'PRESENTATION_WINDOW_LABEL',
      labelDeclaration: 'const PRESENTATION_WINDOW_LABEL: &str = "presentation";',
      permission: 'allow-hide-presentation-window',
      capability: 'presentation',
    },
  ]

  for (const specification of specifications) {
    assert(source.includes(specification.labelDeclaration))
    const signature = new RegExp(`pub fn ${specification.command}\\s*\\(([^)]*)\\)`).exec(source)
    assert(signature, `${specification.command} must exist as a Rust command`)
    assert.match(signature[1], /^window:\s*tauri::WebviewWindow\s*$/)
    assert.doesNotMatch(
      signature[1],
      /label|target|windowName|String|&str/i,
      `${specification.command} must not accept a caller-selected target`,
    )

    const body = commandBlock(source, specification.command)
    assert(body.includes(`require_window_label(&window, ${specification.labelConstant})?`))
    assert(body.includes('window.hide()'))
    assert(!body.includes('.app_handle()'), `${specification.command} must not retrieve an AppHandle`)
    assert(!body.includes('get_webview_window'), `${specification.command} must not look up another window`)

    const holders = capabilities
      .filter((capability) => hasPermission(capability, specification.permission))
      .map((capability) => capability.identifier)
    assert.deepEqual(holders, [specification.capability])
  }
})

test('frontend window control is limited to source-validated application commands', () => {
  const page = read('src/widget-page.ts')
  const shell = read('src/desktop-shell.ts')
  const widget = read('src/widget.ts')
  const settings = read('src/settings.ts')
  const presentation = read('src/presentation-page.ts')

  assert(!page.includes('WebviewWindow'))
  assert(!page.includes('getByLabel'))
  assert(page.includes("invoke('open_presentation_controller')"))

  assert(shell.includes("invoke<MainWindowMetrics>('resize_main_widget'"))
  assert(shell.includes("invoke('configure_main_widget')"))
  assert(shell.includes("invoke('show_main_widget')"))
  assert(shell.includes('appWindow.onScaleChanged'), 'DPI change behavior must remain event-driven')

  assert(!widget.includes('getCurrentWindow'))
  assert(widget.includes("invoke('hide_main_widget')"))
  assert(widget.includes("invoke('start_main_widget_drag')"))

  assert(!settings.includes('getCurrentWindow'))
  assert(settings.includes('requestSettingsWindowClose'))
  assert(settings.includes("invoke('hide_settings_window')"))
  assert(settings.includes("window.confirm('放弃未保存的修改？')"))

  assert(presentation.includes('getCurrentWindow'))
  assert(presentation.includes('controllerWindow.onCloseRequested'))
  assert(presentation.includes('controllerWindow.onFocusChanged'))
  assert(presentation.includes('hidePresentationWindowOnClose'))
  assert(presentation.includes("invoke('hide_presentation_window')"))

  const forbiddenMethods = [
    '.show(',
    '.hide(',
    '.setFocus(',
    '.setSize(',
    '.setMinSize(',
    '.setMaxSize(',
    '.scaleFactor(',
    '.startDragging(',
  ]
  const violations = []
  for (const path of frontendSourceFiles()) {
    const source = readFileSync(path, 'utf8')
    for (const marker of forbiddenMethods) {
      if (source.includes(marker)) violations.push(`${relative(root, path)}:${marker}`)
    }
  }
  assert.deepEqual(
    violations,
    [],
    `frontend must not call generic window control methods: ${violations.join(', ')}`,
  )
})

test('settings close cancellation preserves state and does not invoke the hide command', async () => {
  let confirmations = 0
  let resets = 0
  let hides = 0

  const closed = await requestSettingsWindowClose({
    hasUnsavedChanges: () => true,
    confirmDiscard: () => {
      confirmations += 1
      return false
    },
    resetState: () => {
      resets += 1
    },
    hideWindow: async () => {
      hides += 1
    },
  })

  assert.equal(closed, false)
  assert.equal(confirmations, 1)
  assert.equal(resets, 0)
  assert.equal(hides, 0)
})

test('settings close confirmation resets state and invokes only its dedicated hide command', async () => {
  const calls = []
  const closed = await requestSettingsWindowClose({
    hasUnsavedChanges: () => true,
    confirmDiscard: () => true,
    resetState: () => {
      calls.push('reset')
    },
    hideWindow: async () => {
      calls.push('hide_settings_window')
    },
  })

  assert.equal(closed, true)
  assert.deepEqual(calls, ['reset', 'hide_settings_window'])
})

test('presentation close request prevents destruction and invokes its dedicated hide command', async () => {
  const calls = []
  await hidePresentationWindowOnClose(
    {
      preventDefault: () => {
        calls.push('preventDefault')
      },
    },
    async () => {
      calls.push('hide_presentation_window')
    },
  )

  assert.deepEqual(calls, ['preventDefault', 'hide_presentation_window'])
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
  const validateWorkflow = read('.github/workflows/validate.yml')
  assert(/permissions:\s*\n\s*contents:\s*read/.test(workflow))
  assert(!/contents:\s*write/.test(workflow))
  assert(!/git\s+(?:add|commit|push)\b/i.test(workflow))
  assert(!/npm install\s+--package-lock-only/i.test(workflow))
  assert(!/cargo\s+(?:update|generate-lockfile)\b/i.test(workflow))

  assert(
    validateWorkflow.includes('cargo check --locked --manifest-path src-tauri/Cargo.toml'),
    'Validate workflow must preserve the ordinary locked Rust check gate',
  )
  assert(
    validateWorkflow.includes('cargo test --locked --manifest-path src-tauri/Cargo.toml --lib'),
    'Validate workflow must preserve the locked Rust library test gate',
  )
  assert(
    !workflow.includes('cargo check --locked --manifest-path src-tauri/Cargo.toml --profile test'),
    'Release workflow must not duplicate the metadata-only test-profile crate graph after linked library tests',
  )

  for (const command of [
    'npm ci',
    'cargo test --locked --manifest-path src-tauri/Cargo.toml --lib',
    'cargo build --release --locked --manifest-path src-tauri/Cargo.toml --features ocr-native-spike --bin ocr-native-spike',
    'cargo check --release --locked --manifest-path src-tauri/Cargo.toml',
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
