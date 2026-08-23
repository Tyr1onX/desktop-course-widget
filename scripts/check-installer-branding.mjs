import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const generator = join(root, 'scripts', 'generate-installer-branding.mjs')
const installerDir = join(root, 'src-tauri', 'installer')

const assets = [
  { name: 'header.bmp', width: 150, height: 57 },
  { name: 'sidebar.bmp', width: 164, height: 314 },
]

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readBitmapContract(asset) {
  const path = join(installerDir, asset.name)
  if (!existsSync(path)) {
    throw new Error(`${asset.name} was not generated`)
  }

  const buffer = readFileSync(path)
  if (buffer.length < 54) {
    throw new Error(`${asset.name} is too small to contain a BMP header`)
  }

  const magic = buffer.subarray(0, 2).toString('ascii')
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

  return {
    name: asset.name,
    width,
    height,
    bitDepth,
    compression,
    bytes: buffer.length,
    sha256: sha256(buffer),
  }
}

function generateAndSnapshot() {
  execFileSync(process.execPath, [generator], { cwd: root, stdio: 'pipe' })
  return assets.map(readBitmapContract)
}

const first = generateAndSnapshot()
const second = generateAndSnapshot()

for (let index = 0; index < assets.length; index += 1) {
  const before = first[index]
  const after = second[index]
  if (before.sha256 !== after.sha256) {
    throw new Error(
      `${before.name} is not deterministic: ${before.sha256} != ${after.sha256}`,
    )
  }
}

for (const asset of second) {
  console.log(
    `${asset.name}: ${asset.width}x${asset.height}, ${asset.bitDepth}-bit, BI_RGB, sha256=${asset.sha256}`,
  )
}
console.log('installer branding contract passed; two consecutive generations are byte-identical')
