import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const generator = join(root, 'scripts', 'generate-installer-branding.mjs')
const installerDir = join(root, 'src-tauri', 'installer')
const sidebar = { name: 'sidebar.bmp', width: 164, height: 314 }
const SIDEBAR_BACKGROUND = [247, 249, 252]

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readBitmapContract(asset) {
  const path = join(installerDir, asset.name)
  if (!existsSync(path)) throw new Error(`${asset.name} was not generated`)

  const buffer = readFileSync(path)
  if (buffer.length < 54) throw new Error(`${asset.name} is too small to contain a BMP header`)

  const magic = buffer.subarray(0, 2).toString('ascii')
  const pixelOffset = buffer.readUInt32LE(10)
  const dibHeaderSize = buffer.readUInt32LE(14)
  const width = buffer.readInt32LE(18)
  const height = buffer.readInt32LE(22)
  const planes = buffer.readUInt16LE(26)
  const bitDepth = buffer.readUInt16LE(28)
  const compression = buffer.readUInt32LE(30)

  if (magic !== 'BM') throw new Error(`${asset.name} magic is ${JSON.stringify(magic)}, expected BM`)
  if (dibHeaderSize < 40) throw new Error(`${asset.name} DIB header is ${dibHeaderSize}, expected at least BITMAPINFOHEADER`)
  if (width !== asset.width) throw new Error(`${asset.name} width is ${width}, expected ${asset.width}`)
  if (height !== asset.height) throw new Error(`${asset.name} height is ${height}, expected ${asset.height}`)
  if (planes !== 1) throw new Error(`${asset.name} planes is ${planes}, expected 1`)
  if (bitDepth !== 24) throw new Error(`${asset.name} bit depth is ${bitDepth}, expected 24`)
  if (compression !== 0) throw new Error(`${asset.name} compression is ${compression}, expected BI_RGB (0)`)

  const rowBytes = Math.ceil((width * 3) / 4) * 4
  for (let y = 0; y < height; y += 1) {
    const row = pixelOffset + y * rowBytes
    for (let x = 0; x < width; x += 1) {
      const index = row + x * 3
      const actual = [buffer[index + 2], buffer[index + 1], buffer[index]]
      if (actual.some((value, channel) => value !== SIDEBAR_BACKGROUND[channel])) {
        throw new Error(
          `${asset.name} contains non-background content at (${x}, ${y}): ` +
            `${actual.join(',')} != ${SIDEBAR_BACKGROUND.join(',')}`,
        )
      }
    }
  }

  return { name: asset.name, width, height, bitDepth, compression, bytes: buffer.length, sha256: sha256(buffer) }
}

function generateAndSnapshot() {
  execFileSync(process.execPath, [generator], { cwd: root, stdio: 'pipe' })
  if (existsSync(join(installerDir, 'header.bmp'))) {
    throw new Error('retired installer header.bmp was regenerated')
  }
  return readBitmapContract(sidebar)
}

const generatorSource = readFileSync(generator, 'utf8')
for (const forbidden of [
  'icon.png',
  'decodePng',
  'compositeImage',
  'blendPixel',
  'drawTimetable',
  'drawVerticalLine',
  'drawHorizontalLine',
  'fillRoundedRect',
  'GRID',
  'COURSE',
]) {
  if (generatorSource.includes(forbidden)) {
    throw new Error(`installer branding reintroduced page artwork: ${forbidden}`)
  }
}

const builtSnapshot = existsSync(join(installerDir, sidebar.name)) ? readBitmapContract(sidebar) : null
const first = generateAndSnapshot()
const second = generateAndSnapshot()

if (first.sha256 !== second.sha256) {
  throw new Error(`${sidebar.name} is not deterministic: ${first.sha256} != ${second.sha256}`)
}
if (builtSnapshot && builtSnapshot.sha256 !== first.sha256) {
  throw new Error(
    `${sidebar.name} left by the Tauri build is stale: ${builtSnapshot.sha256} != current generator ${first.sha256}`,
  )
}

console.log(
  `${second.name}: blank ${second.width}x${second.height}, ${second.bitDepth}-bit, BI_RGB, sha256=${second.sha256}`,
)
console.log('minimal installer branding contract passed; sidebar contains no logo or artwork and no custom header asset is present')
