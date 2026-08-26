import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const settings = readFileSync('src/settings.ts', 'utf8')
const css = readFileSync('src/settings.css', 'utf8')
const generator = readFileSync('scripts/generate-installer-template.mjs', 'utf8')
const packageGate = readFileSync('scripts/verify-native-ocr-package.ps1', 'utf8')
const upgradeSmoke = readFileSync('scripts/windows-release-upgrade-smoke.ps1', 'utf8')
const dualInstallSmoke = readFileSync('scripts/windows-legacy-dual-install-smoke.ps1', 'utf8')
const releaseWorkflow = readFileSync('.github/workflows/release-build.yml', 'utf8')

test('About uses current brand and runtime application version', () => {
  assert.match(settings, /import \{ getVersion \} from '@tauri-apps\/api\/app'/)
  assert.match(settings, /<h3>课刻<\/h3>/)
  assert.match(settings, /applicationVersion = await getVersion\(\)/)
  assert.doesNotMatch(settings, /版本 0\.2\.0|<h3>桌面课表<\/h3>/)
})

test('week empty hint has one non-centered CSS definition', () => {
  assert.equal((css.match(/\.week-empty\s*\{/g) ?? []).length, 1)
  const block = css.match(/\.week-empty\s*\{[^}]+\}/s)?.[0] ?? ''
  assert.match(block, /top:\s*46px/)
  assert.doesNotMatch(block, /top:\s*50%|translateY/)
})

test('installer generator only migrates the exact historical product identity', () => {
  assert.match(generator, /LEGACY_PRODUCTNAME.*桌面课表/)
  assert.match(generator, /LEGACY_UNINSTKEY/)
  assert.match(generator, /LegacyBrandMigration/)
  assert.doesNotMatch(generator, /StrCpy \$INSTDIR \$4',\n\s*'    Return'/)
  assert.match(generator, /Cleanup is keyed only by the exact historical product identity/)
  assert.match(generator, /LegacyInstallDir/)
  assert.match(generator, /LegacyMainBinaryName/)
  assert.match(generator, /LegacyInstallDir != \$INSTDIR/)
  assert.match(generator, /LegacyInstallDir.*uninstall\.exe.*\/S/)
  assert.match(generator, /refusing unsafe recursive cleanup/)
  assert.match(generator, /DeleteRegKey SHCTX.*LEGACY_UNINSTKEY/)
  assert.match(generator, /SMPROGRAMS.*LEGACY_PRODUCTNAME/)
  assert.match(generator, /DESKTOP.*LEGACY_PRODUCTNAME/)
})

test('packaged OCR gate mirrors release runtime resolver roots', () => {
  assert.match(packageGate, /Join-Path \$exeDir 'ocr-native'/)
  assert.match(packageGate, /Join-Path \$exeDir 'resources\\ocr-native'/)
  assert.match(packageGate, /Join-Path \$exeDir '_up_\\resources\\ocr-native'/)
  assert.doesNotMatch(packageGate, /Get-ChildItem -LiteralPath \$installRoot -Recurse -File \|\s*Where-Object \{ \$expected\.Contains/s)
})

test('upgrade smoke covers current product plus exact legacy residue', () => {
  assert.match(upgradeSmoke, /Seed-LegacyIdentityResidue/)
  assert.match(upgradeSmoke, /current product \+ legacy residue migration passed/)
  assert.match(upgradeSmoke, /ExpectedVersion/)
})

test('v0.3 release gate covers real distinct legacy and current program roots', () => {
  assert.match(dualInstallSmoke, /v0\.3\.0/)
  assert.match(dualInstallSmoke, /v0\.5\.0-beta\.4/)
  assert.match(dualInstallSmoke, /expectedLegacyRoot/)
  assert.match(dualInstallSmoke, /expectedCurrentRoot/)
  assert.match(dualInstallSmoke, /both copies independently runnable/)
  assert.match(dualInstallSmoke, /Legacy main executable remained in the old program root/)
  assert.match(dualInstallSmoke, /shared AppData\/timetable\/settings preserved/)
  assert.match(releaseWorkflow, /Public v0\.3\.0 brand migration/)
  assert.match(releaseWorkflow, /Smoke test real v0\.3\.0 \+ beta\.4 dual-install migration/)
  assert.match(releaseWorkflow, /windows-legacy-dual-install-smoke\.ps1/)
})
