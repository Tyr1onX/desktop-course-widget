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
    'Var IsolatedInstall',
    'Var StaleCurrentInstallState',
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
  '  StrCpy $StaleCurrentInstallState 0',
  '  StrCpy $LegacyInstallDir ""',
  '  StrCpy $LegacyMainBinaryName ""',
  '  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""',
  '  ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayName"',
  '  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "Publisher"',
  '  ReadRegStr $R2 SHCTX "${UNINSTKEY}" "InstallLocation"',
  '  ReadRegStr $R3 SHCTX "${UNINSTKEY}" "UninstallString"',
  '  ${If} $4 != ""',
  '    ; Never trust the manufacturer install root by itself. It must agree with a complete production uninstall registration.',
  '    StrCpy $R4 $R2 1',
  '    ${If} $R4 == "$\\\""',
  '      StrCpy $R2 $R2 "" 1',
  '    ${EndIf}',
  '    StrCpy $R4 $R2 1 -1',
  '    ${If} $R4 == "$\\\""',
  '      StrCpy $R2 $R2 -1',
  '    ${EndIf}',
  '    StrCpy $R4 "$\\\"$4\\uninstall.exe$\\\""',
  '    ${If} $R0 != "${PRODUCTNAME}"',
  '    ${OrIf} $R1 != "${MANUFACTURER}"',
  '    ${OrIf} $R2 != $4',
  '    ${OrIf} $R3 != $R4',
  '      DetailPrint "Saved install location is incomplete or inconsistent; using the canonical default."',
  '      StrCpy $StaleCurrentInstallState 1',
  '      StrCpy $4 ""',
  '    ${EndIf}',
  '  ${ElseIf} $R0 != ""',
  '  ${OrIf} $R1 != ""',
  '  ${OrIf} $R2 != ""',
  '  ${OrIf} $R3 != ""',
  '    DetailPrint "Current uninstall registration has no matching manufacturer install root; treating it as stale."',
  '    StrCpy $StaleCurrentInstallState 1',
  '  ${EndIf}',
  '',
  '  ${If} $4 != ""',
  '    ; Historical dev/marketing installs used the production identity with ephemeral roots. Refuse to inherit those roots.',
  '    ${StrCase} $R4 $4 "L"',
  '    ${StrCase} $R5 "$TEMP\\" "L"',
  '    ${StrLoc} $R6 $R4 ".marketing-install" ">"',
  '    ${StrLoc} $R7 "$R4\\" $R5 ">"',
  '    ${If} $R6 != ""',
  '      DetailPrint "Saved install location points at a marketing/dev root; using the canonical default: $4"',
  '      StrCpy $StaleCurrentInstallState 1',
  '      StrCpy $4 ""',
  '    ${ElseIf} $R7 == "0"',
  '      DetailPrint "Saved install location points inside TEMP; using the canonical default: $4"',
  '      StrCpy $StaleCurrentInstallState 1',
  '      StrCpy $4 ""',
  '    ${EndIf}',
  '  ${EndIf}',
  '',
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
  '        ; Reuse the historical install root only for a clean brand migration.',
  '        ; If the current product identity was stale/rejected, keep the canonical new-product root and retire legacy separately.',
  '        ${If} $4 == ""',
  '        ${AndIf} $StaleCurrentInstallState != 1',
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


const reinstallDetectionAnchor = [
  '  wix_loop_done:',
  '',
  '  ; Check if there is an existing installation, if not, abort the reinstall page',
].join('\n')
const reinstallDetectionWithStaleGuard = [
  '  wix_loop_done:',
  '',
  '  ; A rejected/incomplete NSIS identity must never be offered as a maintenance target.',
  '  ; Continue with a normal install so the successful install can overwrite stale registration and shortcuts.',
  '  ${If} $StaleCurrentInstallState = 1',
  '  ${AndIf} $WixMode != 1',
  '    Abort',
  '  ${EndIf}',
  '',
  '  ; Check if there is an existing installation, if not, abort the reinstall page',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  reinstallDetectionAnchor,
  reinstallDetectionWithStaleGuard,
  'stale current identity maintenance-page guard',
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


const initPassiveAnchor = [
  'Function .onInit',
  '  ${GetOptions} $CMDLINE "/P" $PassiveMode',
  '  ${IfNot} ${Errors}',
  '    StrCpy $PassiveMode 1',
  '  ${EndIf}',
  '',
  '  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode',
].join('\n')
const initWithIsolatedFlag = [
  'Function .onInit',
  '  ${GetOptions} $CMDLINE "/P" $PassiveMode',
  '  ${IfNot} ${Errors}',
  '    StrCpy $PassiveMode 1',
  '  ${EndIf}',
  '',
  '  ${GetOptions} $CMDLINE "/ISOLATED" $IsolatedInstall',
  '  ${IfNot} ${Errors}',
  '    StrCpy $IsolatedInstall 1',
  '  ${EndIf}',
  '',
  '  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  initPassiveAnchor,
  initWithIsolatedFlag,
  'isolated installer flag parsing',
)

const setContextAnchor = [
  '  !insertmacro SetContext',
  '',
  '  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"',
].join('\n')
const setContextWithIsolation = [
  '  !insertmacro SetContext',
  '',
  '  ; /ISOLATED is an internal dev/CI mode. It must be silent and must use an explicit /D= root.',
  '  ; In this mode files are laid down for runtime verification without touching production registry or shortcuts.',
  '  ${If} $IsolatedInstall = 1',
  '    ${IfNot} ${Silent}',
  '      DetailPrint "Isolated install requires /S; refusing an interactive production-identity install."',
  '      SetErrorLevel 87',
  '      Quit',
  '    ${EndIf}',
  '    ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"',
  '      DetailPrint "Isolated install requires an explicit /D=<path>; refusing to use the production install root."',
  '      SetErrorLevel 87',
  '      Quit',
  '    ${EndIf}',
  '  ${EndIf}',
  '',
  '  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  setContextAnchor,
  setContextWithIsolation,
  'isolated installer safety preconditions',
)

const associationsAnchor = '  ; Create file associations'
generated = replaceExactlyOnce(
  generated,
  associationsAnchor,
  [
    '  ; Isolated installs are runtime/package probes only and must not create system integration.',
    '  ${If} $IsolatedInstall != 1',
    associationsAnchor,
  ].join('\n'),
  'isolated file-association guard',
)

const uninstallerAnchor = [
  '  ; Create uninstaller',
  '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  uninstallerAnchor,
  [
    '  ${EndIf}',
    '',
    '  ; Production registration is intentionally skipped for isolated dev/CI installs.',
    '  ${If} $IsolatedInstall != 1',
    uninstallerAnchor,
  ].join('\n'),
  'isolated production-registration guard start',
)

const shortcutTailAnchor = [
  '  ${If} $PassiveMode = 1',
  '  ${OrIf} ${Silent}',
  '    Call CreateOrUpdateDesktopShortcut',
  '  ${EndIf}',
  '',
  '  !ifmacrodef NSIS_HOOK_POSTINSTALL',
].join('\n')
const shortcutTailWithIsolation = [
  '  ${If} $PassiveMode = 1',
  '  ${OrIf} ${Silent}',
  '    Call CreateOrUpdateDesktopShortcut',
  '  ${EndIf}',
  '  ${Else}',
  '    DetailPrint "Isolated install complete: production registry, uninstaller, file associations, and shortcuts were skipped."',
  '  ${EndIf}',
  '',
  '  !ifmacrodef NSIS_HOOK_POSTINSTALL',
].join('\n')
generated = replaceExactlyOnce(
  generated,
  shortcutTailAnchor,
  shortcutTailWithIsolation,
  'isolated production-registration guard end',
)

for (const functionName of ['CreateOrUpdateStartMenuShortcut', 'CreateOrUpdateDesktopShortcut']) {
  const anchor = `Function ${functionName}`
  generated = replaceExactlyOnce(
    generated,
    anchor,
    [
      anchor,
      '  ${If} $IsolatedInstall = 1',
      '    DetailPrint "Isolated install: shortcut creation suppressed."',
      '    Return',
      '  ${EndIf}',
    ].join('\n'),
    `isolated ${functionName} guard`,
  )
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, generated, 'utf8')

console.log(
  `installer template v2: tauri-bundler-v2.9.4 blob=${sourceBlob}, patched finish-page auto-advance + exact legacy brand migration`,
)
