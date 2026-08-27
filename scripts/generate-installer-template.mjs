import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'installer')
const outPath = join(outDir, 'installer-v2.nsi')

const SOURCE_URL =
  'https://raw.githubusercontent.com/tauri-apps/tauri/tauri-bundler-v2.9.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi'
const EXPECTED_SOURCE_BLOB = 'd372e3c391770cf231db974422a1e4f8adaac3a6'
const NO_AUTO_CLOSE_DIRECTIVE = '!define MUI_FINISHPAGE_NOAUTOCLOSE'

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(buffer).digest('hex')
}

const response = await fetch(SOURCE_URL)
if (!response.ok) {
  throw new Error(`failed to fetch pinned Tauri NSIS template: HTTP ${response.status}`)
}

const sourceBuffer = Buffer.from(await response.arrayBuffer())
const sourceBlob = gitBlobSha(sourceBuffer)
if (sourceBlob !== EXPECTED_SOURCE_BLOB) {
  throw new Error(
    `pinned Tauri NSIS template changed: ${sourceBlob} != ${EXPECTED_SOURCE_BLOB}`,
  )
}

const source = sourceBuffer.toString('utf8')
const occurrences = source.split(NO_AUTO_CLOSE_DIRECTIVE).length - 1
if (occurrences !== 1) {
  throw new Error(`expected exactly one ${NO_AUTO_CLOSE_DIRECTIVE}, found ${occurrences}`)
}

let generated = source.replace(
  [
    "; Don't auto jump to finish page after installation page,",
    '; because the installation page has useful info that can be used debug any issues with the installer.',
    NO_AUTO_CLOSE_DIRECTIVE,
  ].join('\n'),
  '; Auto-advance to the finish page after a successful interactive installation.',
)

if (generated === source || generated.includes(NO_AUTO_CLOSE_DIRECTIVE)) {
  throw new Error('failed to apply the single installer finish-page patch')
}

function replaceExactlyOnce(value, needle, replacement, label) {
  const occurrences = value.split(needle).length - 1
  if (occurrences !== 1) {
    throw new Error(`${label}: expected exactly one anchor, found ${occurrences}`)
  }
  return value.replace(needle, replacement)
}

const productKeyAnchor = [
  '!define UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCTNAME}"',
  '!define MANUKEY "Software\\${MANUFACTURER}"',
  '!define MANUPRODUCTKEY "${MANUKEY}\\${PRODUCTNAME}"',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  productKeyAnchor,
  [
    productKeyAnchor,
    '!define LEGACY_PRODUCTNAME "桌面课表"',
    '!define LEGACY_UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${LEGACY_PRODUCTNAME}"',
    '!define LEGACY_MANUPRODUCTKEY "${MANUKEY}\\${LEGACY_PRODUCTNAME}"',
  ].join('\n'),
  'legacy product key definitions',
)

generated = replaceExactlyOnce(
  generated,
  'Var PassiveMode',
  [
    'Var PassiveMode',
    'Var LegacyBrandMigration',
    'Var LegacyInstallDir',
    'Var LegacyMainBinaryName',
  ].join('\n'),
  'legacy migration state variables',
)

const restoreAnchor = [
  'Function RestorePreviousInstallLocation',
  '  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""',
  '  StrCmp $4 "" +2 0',
  '    StrCpy $INSTDIR $4',
  'FunctionEnd',
].join('\n')
const restoreWithLegacy = [
  'Function RestorePreviousInstallLocation',
  '  StrCpy $LegacyBrandMigration 0',
  '  StrCpy $LegacyInstallDir ""',
  '  StrCpy $LegacyMainBinaryName ""',
  '  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""',
  '  ${If} $4 != ""',
  '    StrCpy $INSTDIR $4',
  '  ${EndIf}',
  '',
  '  ; Only the exact historical product identity published by this project is eligible for migration.',
  '  ReadRegStr $5 SHCTX "${LEGACY_UNINSTKEY}" "DisplayName"',
  '  ReadRegStr $6 SHCTX "${LEGACY_UNINSTKEY}" "Publisher"',
  '  ${If} $5 == "${LEGACY_PRODUCTNAME}"',
  '  ${AndIf} $6 == "${MANUFACTURER}"',
  '    ; Tauri stores the canonical, unquoted install root in the manufacturer product key.',
  '    ReadRegStr $LegacyInstallDir SHCTX "${LEGACY_MANUPRODUCTKEY}" ""',
  '',
  '    ; Keep the uninstall registration as a fallback/check, normalizing optional surrounding quotes.',
  '    ReadRegStr $7 SHCTX "${LEGACY_UNINSTKEY}" "InstallLocation"',
  '    StrCpy $8 $7 1',
  '    ${If} $8 == "$\\\""',
  '      StrCpy $7 $7 "" 1',
  '    ${EndIf}',
  '    StrCpy $8 $7 1 -1',
  '    ${If} $8 == "$\\\""',
  '      StrCpy $7 $7 -1',
  '    ${EndIf}',
  '',
  '    ${If} $LegacyInstallDir == ""',
  '      StrCpy $LegacyInstallDir $7',
  '    ${ElseIf} $7 != ""',
  '    ${AndIf} $LegacyInstallDir != $7',
  '      DetailPrint "Legacy identity paths disagree; refusing migration."',
  '      StrCpy $LegacyInstallDir ""',
  '    ${EndIf}',
  '',
  '    ; The uninstall command must point at the same trusted legacy root before it may ever be executed.',
  '    ${If} $LegacyInstallDir != ""',
  '      ReadRegStr $9 SHCTX "${LEGACY_UNINSTKEY}" "UninstallString"',
  '      StrCpy $8 "$\\\"$LegacyInstallDir\\uninstall.exe$\\\""',
  '      ${If} $9 == $8',
  '        StrCpy $LegacyBrandMigration 1',
  '        ReadRegStr $LegacyMainBinaryName SHCTX "${LEGACY_UNINSTKEY}" "MainBinaryName"',
  '        ${If} $LegacyMainBinaryName == ""',
  '          StrCpy $LegacyMainBinaryName "${MAINBINARYNAME}.exe"',
  '        ${EndIf}',
  '        ; Reuse the historical install root only when the current product has no saved location.',
  '        ${If} $4 == ""',
  '          StrCpy $INSTDIR $LegacyInstallDir',
  '        ${EndIf}',
  '      ${Else}',
  '        DetailPrint "Legacy uninstall command does not match its trusted install root; refusing migration."',
  '        StrCpy $LegacyInstallDir ""',
  '      ${EndIf}',
  '    ${EndIf}',
  '  ${EndIf}',
  'FunctionEnd',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  restoreAnchor,
  restoreWithLegacy,
  'legacy install location migration',
)

const postInstallAnchor = [
  '  !ifmacrodef NSIS_HOOK_POSTINSTALL',
  '    !insertmacro NSIS_HOOK_POSTINSTALL',
  '  !endif',
].join('\n')
const postInstallMigration = [
  postInstallAnchor,
  '',
  '  ; After the new product is fully installed, retire only the previously validated old identity.',
  '  ${If} $LegacyBrandMigration = 1',
  '    ; A distinct historical program root is removed by its own silent uninstaller.',
  '    ; Never recurse-delete it: the historical Tauri uninstaller preserves shared app data by default.',
  '    ${If} $LegacyInstallDir != ""',
  '    ${AndIf} $LegacyInstallDir != $INSTDIR',
  '      IfFileExists "$LegacyInstallDir\\uninstall.exe" legacy_uninstaller_found 0',
  '        DetailPrint "Legacy uninstaller missing; refusing unsafe recursive cleanup: $LegacyInstallDir"',
  '        SetErrorLevel 1603',
  '        Quit',
  '      legacy_uninstaller_found:',
  '      ; NSIS uninstallers normally relaunch from TEMP, so a plain ExecWait returns before real cleanup finishes.',
  '      ; Stage the already validated uninstaller ourselves, then use the same _?= contract Tauri uses',
  '      ; for blocking nested uninstalls. Running the staged copy also lets the original uninstall.exe be removed.',
  '      InitPluginsDir',
  '      CreateDirectory "$PLUGINSDIR\\legacy-brand-migration"',
  '      CopyFiles /SILENT /FILESONLY "$LegacyInstallDir\\uninstall.exe" "$PLUGINSDIR\\legacy-brand-migration"',
  '      IfFileExists "$PLUGINSDIR\\legacy-brand-migration\\uninstall.exe" legacy_uninstaller_staged 0',
  '        DetailPrint "Failed to stage validated legacy uninstaller; refusing unsafe recursive cleanup."',
  '        SetErrorLevel 1603',
  '        Quit',
  '      legacy_uninstaller_staged:',
  '      ExecWait \'"$PLUGINSDIR\\legacy-brand-migration\\uninstall.exe" /S _?=$LegacyInstallDir\' $1',
  '      ${If} $1 != 0',
  '        DetailPrint "Legacy uninstaller failed with exit code $1; refusing unsafe recursive cleanup."',
  '        SetErrorLevel $1',
  '        Quit',
  '      ${EndIf}',
  '      IfFileExists "$LegacyInstallDir\\$LegacyMainBinaryName" 0 legacy_program_removed',
  '        DetailPrint "Legacy main executable remained after uninstall; refusing to hide an independently runnable old copy."',
  '        SetErrorLevel 1603',
  '        Quit',
  '      legacy_program_removed:',
  '    ${EndIf}',
  '    ReadRegStr $0 SHCTX "${LEGACY_UNINSTKEY}" "DisplayName"',
  '    ReadRegStr $2 SHCTX "${LEGACY_UNINSTKEY}" "Publisher"',
  '    ${If} $0 == "${LEGACY_PRODUCTNAME}"',
  '    ${AndIf} $2 == "${MANUFACTURER}"',
  '      DeleteRegKey SHCTX "${LEGACY_UNINSTKEY}"',
  '    ${EndIf}',
  '    ReadRegStr $0 SHCTX "${LEGACY_MANUPRODUCTKEY}" ""',
  '    ${If} $0 == $LegacyInstallDir',
  '      DeleteRegKey SHCTX "${LEGACY_MANUPRODUCTKEY}"',
  '    ${EndIf}',
  '    Delete "$SMPROGRAMS\\${LEGACY_PRODUCTNAME}.lnk"',
  '    Delete "$DESKTOP\\${LEGACY_PRODUCTNAME}.lnk"',
  '  ${EndIf}',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  postInstallAnchor,
  postInstallMigration,
  'legacy post-install cleanup',
)

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, generated, 'utf8')

console.log(
  `installer template v2: tauri-bundler-v2.9.4 blob=${sourceBlob}, patched finish-page auto-advance + exact legacy brand migration`,
)
