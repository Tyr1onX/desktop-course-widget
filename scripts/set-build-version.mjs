import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version || !/^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/set-build-version.mjs <0.x.y[-prerelease]>')
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
packageJson.version = version
writeJson('package.json', packageJson)

const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
packageLock.version = version
if (!packageLock.packages?.['']) throw new Error('package-lock.json has no root package entry')
packageLock.packages[''].version = version
writeJson('package-lock.json', packageLock)

const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
tauriConfig.version = version
writeJson('src-tauri/tauri.conf.json', tauriConfig)

const cargoTomlPath = 'src-tauri/Cargo.toml'
const cargoToml = readFileSync(cargoTomlPath, 'utf8')
const packageStart = cargoToml.indexOf('[package]')
const nextSection = cargoToml.indexOf('\n[', packageStart + 1)
if (packageStart < 0 || nextSection < 0) throw new Error('Cargo.toml package section was not found')
const packageSection = cargoToml.slice(packageStart, nextSection)
const updatedPackageSection = packageSection.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
)
if (updatedPackageSection === packageSection) throw new Error('Cargo.toml package version was not updated')
writeFileSync(
  cargoTomlPath,
  `${cargoToml.slice(0, packageStart)}${updatedPackageSection}${cargoToml.slice(nextSection)}`,
  'utf8',
)

const cargoLockPath = 'src-tauri/Cargo.lock'
const cargoLock = readFileSync(cargoLockPath, 'utf8')
const updatedCargoLock = cargoLock.replace(
  /(\[\[package\]\]\nname = "desktop-course-widget"\nversion = ")[^"]+("\n)/,
  `$1${version}$2`,
)
if (updatedCargoLock === cargoLock) throw new Error('Cargo.lock root package version was not updated')
writeFileSync(cargoLockPath, updatedCargoLock, 'utf8')

console.log(`Prepared application version ${version}`)
