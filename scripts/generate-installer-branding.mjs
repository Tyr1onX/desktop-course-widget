import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'installer')
mkdirSync(outDir, { recursive: true })

const SIDEBAR_BACKGROUND = [247, 249, 252]
const SIDEBAR_WIDTH = 164
const SIDEBAR_HEIGHT = 314

function bmp24(width, height, color) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowBytes * height
  const fileSize = 54 + pixelBytes
  const buffer = Buffer.alloc(fileSize)

  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(fileSize, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelBytes, 34)
  buffer.writeInt32LE(3780, 38)
  buffer.writeInt32LE(3780, 42)

  for (let y = 0; y < height; y += 1) {
    const row = 54 + y * rowBytes
    for (let x = 0; x < width; x += 1) {
      const outputIndex = row + x * 3
      buffer[outputIndex] = color[2]
      buffer[outputIndex + 1] = color[1]
      buffer[outputIndex + 2] = color[0]
    }
  }

  return buffer
}

const sidebar = bmp24(SIDEBAR_WIDTH, SIDEBAR_HEIGHT, SIDEBAR_BACKGROUND)
rmSync(join(outDir, 'header.bmp'), { force: true })
writeFileSync(join(outDir, 'sidebar.bmp'), sidebar)

console.log(
  `installer branding minimal: blank sidebar.bmp ${SIDEBAR_WIDTH}x${SIDEBAR_HEIGHT}, ` +
    `${sidebar.length} bytes; page logo removed; custom header image disabled`,
)
