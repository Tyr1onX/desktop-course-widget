import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const settings = readFileSync('src/settings.ts', 'utf8')
const css = readFileSync('src/settings.css', 'utf8')
const generator = readFileSync('scripts/generate-installer-template.mjs', 'utf8')
const packageGate = readFileSync('scripts/verify-native-ocr-package.ps1', 'utf8')
const upgradeSmoke = readFileSync('scripts/windows-release-upgrade-smoke.ps1', 'utf8')
const dualInstallSmoke = readFileSync('scripts/windows-legacy-dual-install-smoke.ps1', 'utf8')
const migrationHelpers = readFileSync('scripts/windows-migration-smoke-helpers.ps1', 'utf8')
const releaseWorkflow = readFileSync('.github/workflows/release-build.yml', 'utf8')

function topLevelFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} is missing`)
  const next = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, next >= 0 ? next : source.length)
}

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

test('installer generator only migrates the trusted historical product identity', () => {
  assert.match(generator, /LEGACY_PRODUCTNAME.*桌面课表/)
  assert.match(generator, /LEGACY_UNINSTKEY/)
  assert.match(generator, /LEGACY_MANUPRODUCTKEY/)
  assert.match(generator, /LegacyBrandMigration/)
  assert.doesNotMatch(generator, /StrCpy \$INSTDIR \$4',\n\s*'    Return'/)

  const displayNameCheck = generator.indexOf('${If} $5 == "${LEGACY_PRODUCTNAME}"')
  const publisherCheck = generator.indexOf('${AndIf} $6 == "${MANUFACTURER}"')
  const migrationEnable = generator.indexOf('StrCpy $LegacyBrandMigration 1')
  assert.ok(displayNameCheck >= 0, 'legacy DisplayName check is missing')
  assert.ok(publisherCheck > displayNameCheck, 'legacy Publisher must be checked with DisplayName')
  assert.ok(migrationEnable > publisherCheck, 'migration must not be enabled before Publisher validation')

  assert.match(generator, /ReadRegStr \$6 SHCTX.*LEGACY_UNINSTKEY.*Publisher/)
  assert.match(generator, /\$6 == .*MANUFACTURER/)
  assert.match(generator, /LegacyInstallDir/)
  assert.match(generator, /LegacyMainBinaryName/)
  assert.match(generator, /LegacyInstallDir != \$INSTDIR/)
  assert.match(generator, /refusing unsafe recursive cleanup/)
  assert.match(generator, /DeleteRegKey SHCTX.*LEGACY_UNINSTKEY/)
  assert.match(generator, /SMPROGRAMS.*LEGACY_PRODUCTNAME/)
  assert.match(generator, /DESKTOP.*LEGACY_PRODUCTNAME/)
})

test('legacy install root prefers manufacturer product key and normalizes quoted fallback', () => {
  const productKeyRead = generator.indexOf(
    'ReadRegStr $LegacyInstallDir SHCTX "${LEGACY_MANUPRODUCTKEY}" ""',
  )
  const registrationRead = generator.indexOf(
    'ReadRegStr $7 SHCTX "${LEGACY_UNINSTKEY}" "InstallLocation"',
  )
  assert.ok(productKeyRead >= 0, 'legacy manufacturer product key read is missing')
  assert.ok(registrationRead > productKeyRead, 'registration InstallLocation must only be fallback/check')

  assert.match(generator, /StrCpy \$8 \$7 1/)
  assert.match(generator, /StrCpy \$7 \$7 "" 1/)
  assert.match(generator, /StrCpy \$8 \$7 1 -1/)
  assert.match(generator, /StrCpy \$7 \$7 -1/)
  assert.match(generator, /Legacy identity paths disagree; refusing migration/)
})

test('distinct legacy root uses a validated blocking NSIS uninstall without unsafe deletion', () => {
  const uninstallRead = generator.indexOf(
    'ReadRegStr $9 SHCTX "${LEGACY_UNINSTKEY}" "UninstallString"',
  )
  const migrationEnable = generator.indexOf('StrCpy $LegacyBrandMigration 1')
  const stageCopy = generator.indexOf(
    'CopyFiles /SILENT /FILESONLY "$LegacyInstallDir\\\\uninstall.exe" "$PLUGINSDIR\\\\legacy-brand-migration"',
  )
  const blockingUninstall = generator.indexOf(
    'ExecWait \\\'"$PLUGINSDIR\\\\legacy-brand-migration\\\\uninstall.exe" /S _?=$LegacyInstallDir\\\' $1',
  )
  const mainRemains = generator.indexOf(
    'IfFileExists "$LegacyInstallDir\\\\$LegacyMainBinaryName" 0 legacy_program_removed',
  )
  assert.ok(uninstallRead >= 0, 'legacy UninstallString validation is missing')
  assert.ok(migrationEnable > uninstallRead, 'migration must require validated UninstallString')
  assert.ok(stageCopy > migrationEnable, 'validated legacy uninstaller must be staged only after migration is trusted')
  assert.ok(blockingUninstall > stageCopy, 'staged legacy uninstaller must use blocking NSIS _?= invocation')
  assert.ok(mainRemains > blockingUninstall, 'old main executable must be checked after the blocking uninstall returns')
  assert.match(generator, /Legacy uninstall command does not match its trusted install root; refusing migration/)
  assert.match(generator, /Legacy uninstaller missing; refusing unsafe recursive cleanup/)
  assert.match(generator, /Legacy uninstaller failed with exit code/)
  assert.match(generator, /Legacy main executable remained after uninstall/)
  assert.match(generator, /InitPluginsDir/)
  assert.match(generator, /_\?=\$LegacyInstallDir/)
  assert.doesNotMatch(generator, /ExecWait[^\n]*\$LegacyInstallDir\\\\uninstall\.exe[^\n]*\/S\\\' \$1/)
  assert.doesNotMatch(generator, /RMDir \/r[^\n]*LegacyInstallDir|RMDir \/r[^\n]*LEGACY_PRODUCTNAME/)
})

test('packaged OCR gate mirrors release runtime resolver roots', () => {
  assert.match(packageGate, /Join-Path \$exeDir 'ocr-native'/)
  assert.match(packageGate, /Join-Path \$exeDir 'resources\\ocr-native'/)
  assert.match(packageGate, /Join-Path \$exeDir '_up_\\resources\\ocr-native'/)
  assert.doesNotMatch(packageGate, /Get-ChildItem -LiteralPath \$installRoot -Recurse -File \|\s*Where-Object \{ \$expected\.Contains/s)
})

test('direct and dual v0.3 migration use the same pre-catalog settings fixture', () => {
  const helperImport = /\. \(Join-Path \$PSScriptRoot 'windows-migration-smoke-helpers\.ps1'\)/
  assert.match(upgradeSmoke, helperImport)
  assert.match(dualInstallSmoke, helperImport)

  for (const [label, source] of [
    ['direct upgrade', upgradeSmoke],
    ['dual install', dualInstallSmoke],
  ]) {
    assert.match(source, /Set-V03MigrationSettingsMarker/)
    assert.match(source, /-PreCatalogBaseline \(-not \$activePath\)/)
    assert.equal(
      (source.match(/Set-V03MigrationSettingsMarker/g) ?? []).length,
      1,
      `${label} must use exactly one shared settings baseline call`,
    )
  }

  const fixture = topLevelFunctionBody(migrationHelpers, 'Set-V03MigrationSettingsMarker')
  const rejectCatalogMissingSettings = fixture.indexOf('elseif (-not $PreCatalogBaseline)')
  const seedPreCatalog = fixture.indexOf('New-V03CompatibleSettingsMarker')
  assert.ok(rejectCatalogMissingSettings >= 0, 'catalog baselines must still require settings.json')
  assert.ok(seedPreCatalog > rejectCatalogMissingSettings, 'only a pre-catalog baseline may seed settings')
  assert.match(fixture, /Write-MigrationUtf8Json \$SettingsPath \$settings/)

  const v03Fixture = topLevelFunctionBody(migrationHelpers, 'New-V03CompatibleSettingsMarker')
  assert.match(v03Fixture, /schemaVersion = 1/)
  assert.match(v03Fixture, /section = 10; start = '18:55'; end = '19:40'/)
  assert.doesNotMatch(v03Fixture, /schedules|activeScheduleId|catalog/i)
})

test('shortcut verification diagnoses readers and guards target before path normalization', () => {
  const verifier = topLevelFunctionBody(migrationHelpers, 'Assert-MigrationShortcutTarget')
  const emptyGuard = verifier.indexOf('IsNullOrWhiteSpace([string]$target)')
  const normalize = verifier.indexOf('[IO.Path]::GetFullPath([string]$target)')
  const compare = verifier.indexOf('$actualTarget -ne $expectedFull')
  const targetExists = verifier.indexOf('Test-Path -LiteralPath $actualTarget')
  assert.ok(emptyGuard >= 0, 'shortcut target must be checked for empty input')
  assert.ok(normalize > emptyGuard, 'GetFullPath must only run after the non-empty target guard')
  assert.ok(compare > normalize, 'shortcut target equality check must remain after normalization')
  assert.ok(targetExists > compare, 'shortcut target must also exist on disk')

  const diagnostic = topLevelFunctionBody(migrationHelpers, 'Get-MigrationShortcutDiagnostic')
  for (const field of ['Length', 'TargetPath', 'WorkingDirectory', 'Arguments', 'ShellTarget', 'ResolvedTarget']) {
    assert.match(diagnostic, new RegExp(`${field} =`), `shortcut diagnostic lost ${field}`)
  }
  assert.match(diagnostic, /Shell\.Application/)
  assert.match(diagnostic, /System\.Link\.TargetParsingPath/)

  for (const [label, source] of [
    ['direct upgrade', upgradeSmoke],
    ['dual install', dualInstallSmoke],
  ]) {
    assert.ok(
      (source.match(/Assert-MigrationShortcutTarget/g) ?? []).length >= 2,
      `${label} must keep target validation for both Start Menu and Desktop shortcuts`,
    )
    assert.doesNotMatch(
      source,
      /GetFullPath\([^\n]*CreateShortcut\([^\n]*\.TargetPath/,
      `${label} must not normalize an unchecked WScript TargetPath`,
    )
  }
})

test('residual identity fixture creates real old-brand links from proven candidate links and remains a hard gate', () => {
  const fixture = topLevelFunctionBody(upgradeSmoke, 'Seed-LegacyIdentityResidue')
  const stages = [
    'creating legacy uninstall registry',
    'writing uninstall properties',
    'creating manufacturer product key',
    'writing product root',
    'creating Start Menu legacy shortcut',
    'creating Desktop legacy shortcut',
    'verifying seeded legacy registration',
    'verifying seeded Start Menu shortcut',
    'verifying seeded Desktop shortcut',
  ]
  let prior = -1
  for (const stage of stages) {
    const position = fixture.indexOf(stage)
    assert.ok(position > prior, `residual fixture stage missing or out of order: ${stage}`)
    prior = position
  }

  assert.doesNotMatch(fixture, /CreateShortcut\(/)
  assert.match(fixture, /Copy-Item -LiteralPath \$CurrentStartShortcut -Destination \$legacyStartShortcut -Force/)
  assert.match(fixture, /Copy-Item -LiteralPath \$CurrentDesktopShortcut -Destination \$legacyDesktopShortcut -Force/)
  assert.ok((fixture.match(/Assert-MigrationShortcutTarget/g) ?? []).length >= 2)
  assert.match(fixture, /Get-ItemProperty -LiteralPath \$uninstallKey/)
  assert.match(fixture, /GetValue\('\'\)/)
  assert.match(fixture, /Seed-LegacyIdentityResidue failed: stage=/)

  const call = upgradeSmoke.indexOf('Seed-LegacyIdentityResidue `')
  const reinstall = upgradeSmoke.indexOf('$residualUpgrade = Start-Process', call)
  const passed = upgradeSmoke.indexOf('current product + legacy residue migration passed', reinstall)
  assert.ok(call >= 0 && reinstall > call && passed > reinstall)
  const setup = upgradeSmoke.slice(call, reinstall)
  assert.match(setup, /-CurrentStartShortcut \$newStartShortcut/)
  assert.match(setup, /-CurrentDesktopShortcut \$newDesktopShortcut/)
  const cleanup = upgradeSmoke.slice(reinstall, passed)
  assert.match(cleanup, /Get-UninstallEntries -Name \$baseProductName/)
  assert.match(cleanup, /Legacy shortcut remained when \$productName was already installed/)
  assert.ok((cleanup.match(/Assert-MigrationShortcutTarget/g) ?? []).length >= 2)
})

test('upgrade smoke covers current product plus exact legacy residue', () => {
  assert.match(upgradeSmoke, /Seed-LegacyIdentityResidue/)
  assert.match(upgradeSmoke, /current product \+ legacy residue migration passed/)
  assert.match(upgradeSmoke, /ExpectedVersion/)
  assert.match(upgradeSmoke, /pre-catalog legacy schedule storage/)
  assert.match(upgradeSmoke, /Migrated Start Menu/)
  assert.match(upgradeSmoke, /Migrated Desktop/)
  assert.match(upgradeSmoke, /Residual cleanup Start Menu/)
  assert.match(upgradeSmoke, /Residual cleanup Desktop/)
})

test('dual migration failure snapshot remains read-only and runs before a candidate exit-code failure is thrown', () => {
  const snapshot = topLevelFunctionBody(dualInstallSmoke, 'Write-DualInstallFailureSnapshot')
  assert.match(snapshot, /Write-DualRegistrationSnapshot \$productName/)
  assert.match(snapshot, /Write-DualRegistrationSnapshot \$legacyProductName/)
  assert.match(snapshot, /Get-DualFileSnapshot/)
  assert.match(snapshot, /Write-DualShortcutSnapshot 'current Start Menu'/)
  assert.match(snapshot, /Write-DualShortcutSnapshot 'legacy Desktop'/)
  assert.match(snapshot, /Write-DualDataSnapshot/)
  assert.match(snapshot, /Get-Process -ErrorAction SilentlyContinue/)
  assert.doesNotMatch(snapshot, /Remove-Item|Stop-Process|Set-Item|New-Item/)

  const candidateStart = dualInstallSmoke.indexOf('$candidateInstall = Start-Process')
  const failureSnapshot = dualInstallSmoke.indexOf('Write-DualInstallFailureSnapshot `', candidateStart)
  const candidateThrow = dualInstallSmoke.indexOf('throw "Candidate installer exited with', candidateStart)
  assert.ok(candidateStart >= 0 && failureSnapshot > candidateStart && candidateThrow > failureSnapshot)
})

test('v0.3 release gate covers real distinct legacy and current program roots', () => {
  assert.match(dualInstallSmoke, /v0\.3\.0/)
  assert.match(dualInstallSmoke, /v0\.5\.0-beta\.4/)
  assert.match(dualInstallSmoke, /expectedLegacyRoot/)
  assert.match(dualInstallSmoke, /expectedCurrentRoot/)
  assert.match(dualInstallSmoke, /both copies independently runnable/)
  assert.match(dualInstallSmoke, /Legacy main executable remained in the old program root/)
  assert.match(dualInstallSmoke, /Assert-SharedUserData/)
  assert.match(dualInstallSmoke, /old program copy removed by its default-data-preserving uninstaller/)
  assert.match(dualInstallSmoke, /shared AppData\/timetable\/settings preserved/)
  assert.match(dualInstallSmoke, /pre-catalog legacy schedule storage/)
  assert.match(dualInstallSmoke, /Candidate Start Menu/)
  assert.match(dualInstallSmoke, /Candidate Desktop/)
  assert.match(releaseWorkflow, /Public v0\.3\.0 brand migration/)
  assert.match(releaseWorkflow, /Smoke test public v0\.3\.0 legacy-brand upgrade/)
  assert.match(releaseWorkflow, /Smoke test real v0\.3\.0 \+ beta\.4 dual-install migration/)
  assert.match(releaseWorkflow, /windows-release-upgrade-smoke\.ps1/)
  assert.match(releaseWorkflow, /windows-legacy-dual-install-smoke\.ps1/)
  assert.doesNotMatch(releaseWorkflow, /continue-on-error:\s*true/)
})
