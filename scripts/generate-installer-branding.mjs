import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'installer')
const iconPath = join(root, 'src-tauri', 'icons', 'icon.png')
mkdirSync(outDir, { recursive: true })

const SIDEBAR_BACKGROUND = [247, 249, 252]

function canvas(width, height, color) {
  const pixels = new Uint8Array(width * height * 3)
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = color[0]
    pixels[index + 1] = color[1]
    pixels[index + 2] = color[2]
  }
  return { width, height, pixels }
}

function blendPixel(image, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const index = (y * image.width + x) * 3
  for (let channel = 0; channel < 3; channel += 1) {
    image.pixels[index + channel] = Math.round(
      image.pixels[index + channel] * (1 - alpha) + color[channel] * alpha,
    )
  }
}

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upperLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upperLeft
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('installer logo source is not a PNG')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error(`truncated PNG chunk ${type}`)
    const data = buffer.subarray(dataStart, dataEnd)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      const compression = data[10]
      const filter = data[11]
      interlace = data[12]
      if (compression !== 0 || filter !== 0) throw new Error('unsupported PNG compression/filter method')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(
      `unsupported installer logo PNG: ${width}x${height}, depth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`,
    )
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`unexpected PNG payload length ${raw.length}`)
  }

  const decoded = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (stride + 1)]
    const sourceStart = y * (stride + 1) + 1
    const rowStart = y * stride
    for (let x = 0; x < stride; x += 1) {
      const value = raw[sourceStart + x]
      const left = x >= channels ? decoded[rowStart + x - channels] : 0
      const up = y > 0 ? decoded[rowStart - stride + x] : 0
      const upperLeft = y > 0 && x >= channels ? decoded[rowStart - stride + x - channels] : 0

      switch (filterType) {
        case 0:
          decoded[rowStart + x] = value
          break
        case 1:
          decoded[rowStart + x] = (value + left) & 0xff
          break
        case 2:
          decoded[rowStart + x] = (value + up) & 0xff
          break
        case 3:
          decoded[rowStart + x] = (value + Math.floor((left + up) / 2)) & 0xff
          break
        case 4:
          decoded[rowStart + x] = (value + paeth(left, up, upperLeft)) & 0xff
          break
        default:
          throw new Error(`unsupported PNG filter ${filterType}`)
      }
    }
  }

  const rgba = new Uint8Array(width * height * 4)
  for (let index = 0, out = 0; index < decoded.length; index += channels, out += 4) {
    rgba[out] = decoded[index]
    rgba[out + 1] = decoded[index + 1]
    rgba[out + 2] = decoded[index + 2]
    rgba[out + 3] = colorType === 6 ? decoded[index + 3] : 255
  }
  return { width, height, rgba }
}

function samplePremultipliedBilinear(source, sx, sy) {
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sx)))
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sy)))
  const x1 = Math.max(0, Math.min(source.width - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(source.height - 1, y0 + 1))
  const fx = Math.max(0, Math.min(1, sx - x0))
  const fy = Math.max(0, Math.min(1, sy - y0))
  const samples = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ]

  let alpha = 0
  const premultiplied = [0, 0, 0]
  for (const [x, y, weight] of samples) {
    const index = (y * source.width + x) * 4
    const sampleAlpha = source.rgba[index + 3] / 255
    const weightedAlpha = sampleAlpha * weight
    alpha += weightedAlpha
    premultiplied[0] += source.rgba[index] * weightedAlpha
    premultiplied[1] += source.rgba[index + 1] * weightedAlpha
    premultiplied[2] += source.rgba[index + 2] * weightedAlpha
  }

  if (alpha <= 0) return { color: [0, 0, 0], alpha: 0 }
  return {
    color: premultiplied.map((value) => Math.round(value / alpha)),
    alpha,
  }
}

function compositeImageBilinear(image, source, x, y, width, height) {
  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = ((targetY + 0.5) * source.height) / height - 0.5
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = ((targetX + 0.5) * source.width) / width - 0.5
      const sample = samplePremultipliedBilinear(source, sourceX, sourceY)
      if (sample.alpha === 0) continue
      blendPixel(image, x + targetX, y + targetY, sample.color, sample.alpha)
    }
  }
}

function bmp24(width, height, rgb) {
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
    const sourceY = height - 1 - y
    const row = 54 + y * rowBytes
    for (let x = 0; x < width; x += 1) {
      const index = (sourceY * width + x) * 3
      const outputIndex = row + x * 3
      buffer[outputIndex] = rgb[index + 2]
      buffer[outputIndex + 1] = rgb[index + 1]
      buffer[outputIndex + 2] = rgb[index]
    }
  }

  return buffer
}

const logo = decodePng(readFileSync(iconPath))

function makeSidebar() {
  const width = 164
  const height = 314
  const image = canvas(width, height, SIDEBAR_BACKGROUND)

  // Keep the same quiet composition; only give the real brand mark enough pixels to stay legible after NSIS/DPI scaling.
  compositeImageBilinear(image, logo, 40, 54, 84, 84)

  return bmp24(width, height, image.pixels)
}

const sidebar = makeSidebar()
rmSync(join(outDir, 'header.bmp'), { force: true })
writeFileSync(join(outDir, 'sidebar.bmp'), sidebar)

console.log(
  `installer branding minimal: source icon=${logo.width}x${logo.height}, ` +
    `sidebar.bmp ${sidebar.length} bytes; custom header image disabled`,
)
