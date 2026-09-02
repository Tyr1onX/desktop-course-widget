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
  '!define LEGACY_MANUPRODUCTKEY "${MANUKEY}\\${LEGACY_PRODUCTNAME}"',
  'Var LegacyBrandMigration',
  'Var LegacyInstallDir',
  'Var LegacyMainBinaryName',
  'Var IsolatedInstall',
  'Var StaleCurrentInstallState',
  '${GetOptions} $CMDLINE "/ISOLATED" $IsolatedInstall',
  'Isolated install requires /S; refusing an interactive production-identity install.',
  'Isolated install requires an explicit /D=<path>; refusing to use the production install root.',
  '; Isolated installs are runtime/package probes only and must not create system integration.',
  '; Production registration is intentionally skipped for isolated dev/CI installs.',
  'Isolated install complete: production registry, uninstaller, file associations, and shortcuts were skipped.',
  'Isolated install: shortcut creation suppressed.',
  'ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayName"',
  'ReadRegStr $R1 SHCTX "${UNINSTKEY}" "Publisher"',
  'ReadRegStr $R2 SHCTX "${UNINSTKEY}" "InstallLocation"',
  'ReadRegStr $R3 SHCTX "${UNINSTKEY}" "UninstallString"',
  'Saved install location is incomplete or inconsistent; using the canonical default.',
  'Current uninstall registration has no matching manufacturer install root; treating it as stale.',
  '${If} $StaleCurrentInstallState = 1',
  '${AndIf} $WixMode != 1',
  '${AndIf} $StaleCurrentInstallState != 1',
  '; A rejected/incomplete NSIS identity must never be offered as a maintenance target.',
  '${StrLoc} $R6 $R4 ".marketing-install" ">"',
  'Saved install location points at a marketing/dev root; using the canonical default:',
  'Saved install location points inside TEMP; using the canonical default:',
  'ReadRegStr $5 SHCTX "${LEGACY_UNINSTKEY}" "DisplayName"',
  'ReadRegStr $6 SHCTX "${LEGACY_UNINSTKEY}" "Publisher"',
  '${AndIf} $6 == "${MANUFACTURER}"',
  'ReadRegStr $LegacyInstallDir SHCTX "${LEGACY_MANUPRODUCTKEY}" ""',
  'ReadRegStr $7 SHCTX "${LEGACY_UNINSTKEY}" "InstallLocation"',
  'StrCpy $7 $7 "" 1',
  'StrCpy $7 $7 -1',
  'Legacy identity paths disagree; refusing migration.',
  'ReadRegStr $9 SHCTX "${LEGACY_UNINSTKEY}" "UninstallString"',
  'StrCpy $8 "$\\"$LegacyInstallDir\\uninstall.exe$\\""',
  'Legacy uninstall command does not match its trusted install root; refusing migration.',
  'StrCpy $LegacyBrandMigration 1',
  '${AndIf} $LegacyInstallDir != $INSTDIR',
  'InitPluginsDir',
  'CreateDirectory "$PLUGINSDIR\\legacy-brand-migration"',
  'CopyFiles /SILENT /FILESONLY "$LegacyInstallDir\\uninstall.exe" "$PLUGINSDIR\\legacy-brand-migration"',
  'IfFileExists "$PLUGINSDIR\\legacy-brand-migration\\uninstall.exe" legacy_uninstaller_staged 0',
  'ExecWait \'"$PLUGINSDIR\\legacy-brand-migration\\uninstall.exe" /S _?=$LegacyInstallDir\' $1',
  'IfFileExists "$LegacyInstallDir\\$LegacyMainBinaryName" 0 legacy_program_removed',
  'refusing unsafe recursive cleanup',
  'ReadRegStr $2 SHCTX "${LEGACY_UNINSTKEY}" "Publisher"',
  '${AndIf} $2 == "${MANUFACTURER}"',
  'DeleteRegKey SHCTX "${LEGACY_UNINSTKEY}"',
  'Delete "$SMPROGRAMS\\${LEGACY_PRODUCTNAME}.lnk"',
  'Delete "$DESKTOP\\${LEGACY_PRODUCTNAME}.lnk"',
]

for (const fragment of requiredFragments) {
  if (!template.includes(fragment)) {
    throw new Error(`custom NSIS template lost required Tauri contract: ${fragment}`)
  }
}

const isolatedParse = template.indexOf('${GetOptions} $CMDLINE "/ISOLATED" $IsolatedInstall')
const isolatedPrecondition = template.indexOf('Isolated install requires an explicit /D=<path>')
const isolatedRegistryGuard = template.indexOf(
  '; Production registration is intentionally skipped for isolated dev/CI installs.',
)
const productionUninstaller = template.indexOf('WriteUninstaller "$INSTDIR\\uninstall.exe"')
const currentRegistrationRead = template.indexOf(
  'ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayName"',
)
const currentConsistencyReject = template.indexOf(
  'Saved install location is incomplete or inconsistent; using the canonical default.',
)
const marketingRootReject = template.indexOf(
  'Saved install location points at a marketing/dev root; using the canonical default:',
)
const restoreCurrentRoot = template.indexOf('StrCpy $INSTDIR $4')
const staleMaintenanceGuard = template.indexOf('${If} $StaleCurrentInstallState = 1')
const currentMaintenanceRead = template.indexOf(
  'ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""',
)
const staleLegacyReuseGuard = template.indexOf('${AndIf} $StaleCurrentInstallState != 1')
const legacyRootReuse = template.indexOf('StrCpy $INSTDIR $LegacyInstallDir')

if (isolatedParse < 0 || isolatedPrecondition <= isolatedParse) {
  throw new Error('isolated installer mode must be parsed and validated before install work begins')
}
if (
  isolatedRegistryGuard < 0 ||
  productionUninstaller <= isolatedRegistryGuard
) {
  throw new Error('production registration/uninstaller must remain behind the isolated-install guard')
}
if (
  currentRegistrationRead < 0 ||
  currentConsistencyReject <= currentRegistrationRead ||
  marketingRootReject <= currentConsistencyReject ||
  restoreCurrentRoot <= marketingRootReject
) {
  throw new Error('saved current install root must be validated and ephemeral roots rejected before restoring $INSTDIR')
}
if (staleMaintenanceGuard < 0 || currentMaintenanceRead <= staleMaintenanceGuard) {
  throw new Error('rejected current NSIS identity must be skipped before the reinstall/maintenance registration is read')
}

if (staleLegacyReuseGuard < 0 || legacyRootReuse <= staleLegacyReuseGuard) {
  throw new Error('stale current product identity must block reusing the legacy-brand install root')
}

const productKeyRead = template.indexOf(
  'ReadRegStr $LegacyInstallDir SHCTX "${LEGACY_MANUPRODUCTKEY}" ""',
)
const registrationLocationRead = template.indexOf(
  'ReadRegStr $7 SHCTX "${LEGACY_UNINSTKEY}" "InstallLocation"',
)
const migrationEnable = template.indexOf('StrCpy $LegacyBrandMigration 1')
const publisherCheck = template.indexOf('${AndIf} $6 == "${MANUFACTURER}"')
const legacyStageCopy = template.indexOf(
  'CopyFiles /SILENT /FILESONLY "$LegacyInstallDir\\uninstall.exe" "$PLUGINSDIR\\legacy-brand-migration"',
)
const blockingLegacyUninstall = template.indexOf(
  'ExecWait \'"$PLUGINSDIR\\legacy-brand-migration\\uninstall.exe" /S _?=$LegacyInstallDir\' $1',
)
const legacyMainCheck = template.indexOf(
  'IfFileExists "$LegacyInstallDir\\$LegacyMainBinaryName" 0 legacy_program_removed',
)
if (
  productKeyRead < 0 ||
  registrationLocationRead < 0 ||
  productKeyRead >= registrationLocationRead
) {
  throw new Error('legacy install root must prefer the manufacturer product key before registration fallback')
}
if (publisherCheck < 0 || migrationEnable < 0 || publisherCheck >= migrationEnable) {
  throw new Error('legacy migration must validate Publisher before enabling migration')
}
if (
  legacyStageCopy < 0 ||
  blockingLegacyUninstall <= legacyStageCopy ||
  legacyMainCheck <= blockingLegacyUninstall
) {
  throw new Error('distinct legacy cleanup must stage the trusted uninstaller, block with _?=, then verify the old main executable is gone')
}
if (template.includes('ExecWait \'"$LegacyInstallDir\\uninstall.exe" /S\' $1')) {
  throw new Error('distinct legacy cleanup regressed to a non-blocking in-place NSIS uninstall invocation')
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
  'installer template contract passed: currentUser + native headers + isolated /ISOLATED dev/CI mode without production identity + stale current-root validation/recovery + installer sidebar + uninstaller icon + uninstall registry preserved; 桌面课表 migration requires matching publisher/root/uninstall command, prefers manufacturer product root, normalizes quoted registration fallback, stages the trusted distinct-root uninstaller and waits with NSIS _?= before verifying retirement; finish page auto-advance enabled',
)
