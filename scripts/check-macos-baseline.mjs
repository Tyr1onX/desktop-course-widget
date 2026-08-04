import { readFileSync } from 'node:fs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const macConfig = JSON.parse(readFileSync('src-tauri/tauri.macos.conf.json', 'utf8'))
const baseConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8')
const settingsHtml = readFileSync('settings.html', 'utf8')
const bootstrap = readFileSync('src/settings-platform-bootstrap.ts', 'utf8')
const macController = readFileSync('src/macos-settings-controller.ts', 'utf8')
const mainSource = readFileSync('src-tauri/src/main.rs', 'utf8')

assert(baseConfig.app?.macOSPrivateApi === true, 'macOS transparent widget support must be enabled')
assert(cargoToml.includes('macos-private-api'), 'Tauri must enable the matching macOS private API Cargo feature')
assert(macConfig.bundle?.targets?.includes('dmg'), 'macOS config must build a DMG')
assert(!('resources' in (macConfig.bundle ?? {})), 'macOS baseline must not add OCR resources')
assert(baseConfig.bundle?.targets?.includes('nsis'), 'Windows NSIS target must remain unchanged')
assert(
  packageJson.scripts?.['tauri:build:macos']?.includes('universal-apple-darwin'),
  'macOS build must produce a Universal binary',
)
assert(
  settingsHtml.includes('/src/settings-platform-bootstrap.ts'),
  'settings page must use the platform bootstrap',
)
assert(
  !settingsHtml.includes('/src/screenshot-import-controller.ts'),
  'settings page must not load screenshot import unconditionally',
)
assert(bootstrap.includes("document.documentElement.dataset.desktopPlatform = 'macos'"), 'macOS runtime must be marked')
assert(bootstrap.includes("import('./macos-settings-controller')"), 'macOS must load the stable settings controller')
assert(bootstrap.includes("import('./screenshot-import-controller')"), 'Windows must retain screenshot import behavior')
assert(macController.includes('从 Excel 创建独立课表'), 'macOS import copy must expose the Excel-only baseline')
assert(macController.includes('[data-action="open-data-location"]'), 'macOS must remove the Windows-only data opener')
assert(
  mainSource.includes('all(not(debug_assertions), target_os = "windows")'),
  'the Windows subsystem attribute must not be applied to macOS',
)

console.log('macOS baseline policy check passed.')
