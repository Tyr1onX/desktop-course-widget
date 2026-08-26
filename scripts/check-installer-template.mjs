import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(
  readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
)
const nsis = config?.bundle?.windows?.nsis

if (!nsis) throw new Error('bundle.windows.nsis is missing')
if (nsis.installMode !== 'currentUser') {
  throw new Error(`installer installMode changed: ${JSON.stringify(nsis.installMode)}`)
}
if (nsis.template !== 'installer/installer-v2.nsi') {
  throw new Error(`unexpected NSIS template path: ${JSON.stringify(nsis.template)}`)
}

for (const [field, expected] of [
  ['installerIcon', 'icons/icon.ico'],
  ['uninstallerIcon', 'icons/icon.ico'],
  ['sidebarImage', 'installer/sidebar.bmp'],
]) {
  if (nsis[field] !== expected) {
    throw new Error(`NSIS ${field} changed: ${JSON.stringify(nsis[field])}`)
  }
}

for (const field of ['headerImage', 'uninstallerHeaderImage']) {
  if (field in nsis) {
    throw new Error(`NSIS ${field} must stay unset for the native header layout`)
  }
}

const template = readFileSync(
  join(root, 'src-tauri', 'installer', 'installer-v2.nsi'),
  'utf8',
)

const requiredFragments = [
  '!if "${INSTALLMODE}" == "currentUser"\n  RequestExecutionLevel user\n!endif',
  'StrCpy $INSTDIR "$LOCALAPPDATA\\${PRODUCTNAME}"',
  '!insertmacro MUI_PAGE_INSTFILES',
  '!insertmacro MUI_PAGE_FINISH',
  '!define MUI_FINISHPAGE_RUN',
  '!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary',
  '!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"',
  '!define MUI_UNICON "${UNINSTALLERICON}"',
  'WriteUninstaller "$INSTDIR\\uninstall.exe"',
  'WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\\"$INSTDIR\\uninstall.exe$\\""',
  'DeleteRegKey HKCU "${UNINSTKEY}"',
  '!define LEGACY_PRODUCTNAME "桌面课表"',
  '!define LEGACY_UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${LEGACY_PRODUCTNAME}"',
  'Var LegacyBrandMigration',
  'Var LegacyInstallDir',
  'Var LegacyMainBinaryName',
  'ReadRegStr $5 SHCTX "${LEGACY_UNINSTKEY}" "DisplayName"',
  'StrCpy $LegacyBrandMigration 1',
  'ReadRegStr $LegacyInstallDir SHCTX "${LEGACY_UNINSTKEY}" "InstallLocation"',
  '${AndIf} $LegacyInstallDir != $INSTDIR',
  'ExecWait \'"$LegacyInstallDir\\uninstall.exe" /S\' $1',
  'IfFileExists "$LegacyInstallDir\\$LegacyMainBinaryName" 0 legacy_program_removed',
  'refusing unsafe recursive cleanup',
  'DeleteRegKey SHCTX "${LEGACY_UNINSTKEY}"',
  'Delete "$SMPROGRAMS\\${LEGACY_PRODUCTNAME}.lnk"',
  'Delete "$DESKTOP\\${LEGACY_PRODUCTNAME}.lnk"',
]

for (const fragment of requiredFragments) {
  if (!template.includes(fragment)) {
    throw new Error(`custom NSIS template lost required Tauri contract: ${fragment}`)
  }
}

if (/^\s*!define\s+MUI_FINISHPAGE_NOAUTOCLOSE\b/m.test(template)) {
  throw new Error('finish page is still configured to require manual Next')
}

const installPage = template.indexOf('!insertmacro MUI_PAGE_INSTFILES')
const finishPage = template.indexOf('!insertmacro MUI_PAGE_FINISH')
if (installPage < 0 || finishPage <= installPage) {
  throw new Error('installer page order no longer keeps finish page after installation')
}

console.log(
  'installer template contract passed: currentUser + native headers + installer sidebar + uninstaller icon + uninstall registry preserved; exact 桌面课表→课刻 migration preserves same-root upgrades and safely uninstalls distinct legacy roots; finish page auto-advance enabled',
)
