import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'installer')
const iconPath = join(root, 'src-tauri', 'icons', 'icon.png')
mkdirSync(outDir, { recursive: true })

const SCALE = 4
const BRAND_BLUE = [10, 117, 232]
const COLD_WHITE = [248, 250, 252]
const COOL_GRAY = [243, 246, 249]
const GRID = [214, 224, 234]
const PALE_BLUE = [225, 239, 252]
const PALE_BLUE_GRAY = [230, 237, 245]

function solidCanvas(width, height, color) {
  const w = width * SCALE
  const h = height * SCALE
  const pixels = new Uint8Array(w * h * 3)
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = color[0]
    pixels[index + 1] = color[1]
    pixels[index + 2] = color[2]
  }
  return { width: w, height: h, pixels }
}

function blendPixel(image, x, y, color, alpha = 1) {
  x = Math.round(x)
  y = Math.round(y)
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const index = (y * image.width + x) * 3
  for (let channel = 0; channel < 3; channel += 1) {
    image.pixels[index + channel] = Math.round(
      image.pixels[index + channel] * (1 - alpha) + color[channel] * alpha,
    )
  }
}

function fillRect(image, x0, y0, x1, y1, color, alpha = 1) {
  x0 = Math.round(x0 * SCALE)
  y0 = Math.round(y0 * SCALE)
  x1 = Math.round(x1 * SCALE)
  y1 = Math.round(y1 * SCALE)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) blendPixel(image, x, y, color, alpha)
  }
}

function fillCircle(image, cx, cy, radius, color, alpha = 1) {
  cx *= SCALE
  cy *= SCALE
  radius *= SCALE
  const minX = Math.floor(cx - radius)
  const maxX = Math.ceil(cx + radius)
  const minY = Math.floor(cy - radius)
  const maxY = Math.ceil(cy + radius)
  const radiusSquared = radius * radius

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= radiusSquared) blendPixel(image, x, y, color, alpha)
    }
  }
}

function fillRoundedRect(image, x0, y0, x1, y1, radius, color, alpha = 1) {
  fillRect(image, x0 + radius, y0, x1 - radius, y1, color, alpha)
  fillRect(image, x0, y0 + radius, x1, y1 - radius, color, alpha)
  fillCircle(image, x0 + radius, y0 + radius, radius, color, alpha)
  fillCircle(image, x1 - radius, y0 + radius, radius, color, alpha)
  fillCircle(image, x0 + radius, y1 - radius, radius, color, alpha)
  fillCircle(image, x1 - radius, y1 - radius, radius, color, alpha)
}

function drawLine(image, x0, y0, x1, y1, width, color, alpha = 1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * SCALE))
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    fillCircle(image, x0 + dx * t, y0 + dy * t, width / 2, color, alpha)
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

function compositeImage(image, source, x, y, width, height) {
  const targetLeft = Math.round(x * SCALE)
  const targetTop = Math.round(y * SCALE)
  const targetWidth = Math.round(width * SCALE)
  const targetHeight = Math.round(height * SCALE)

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(
      source.height - 1,
      Math.floor(((targetY + 0.5) / targetHeight) * source.height),
    )
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.floor(((targetX + 0.5) / targetWidth) * source.width),
      )
      const sourceIndex = (sourceY * source.width + sourceX) * 4
      const alpha = source.rgba[sourceIndex + 3] / 255
      if (alpha === 0) continue
      blendPixel(
        image,
        targetLeft + targetX,
        targetTop + targetY,
        [source.rgba[sourceIndex], source.rgba[sourceIndex + 1], source.rgba[sourceIndex + 2]],
        alpha,
      )
    }
  }
}

function downsample(image, width, height) {
  const output = new Uint8Array(width * height * 3)
  const samples = SCALE * SCALE

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const index = (((y * SCALE + sy) * image.width) + (x * SCALE + sx)) * 3
          sum[0] += image.pixels[index]
          sum[1] += image.pixels[index + 1]
          sum[2] += image.pixels[index + 2]
        }
      }
      const outputIndex = (y * width + x) * 3
      output[outputIndex] = Math.round(sum[0] / samples)
      output[outputIndex + 1] = Math.round(sum[1] / samples)
      output[outputIndex + 2] = Math.round(sum[2] / samples)
    }
  }

  return output
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

function drawTimetableGrid(image, left, top, right, bottom, columns, rows) {
  for (let index = 0; index <= columns; index += 1) {
    const x = left + ((right - left) * index) / columns
    drawLine(image, x, top, x, bottom, 0.45, GRID, 0.78)
  }
  for (let index = 0; index <= rows; index += 1) {
    const y = top + ((bottom - top) * index) / rows
    drawLine(image, left, y, right, y, 0.45, GRID, 0.78)
  }
}

const logo = decodePng(readFileSync(iconPath))

function makeHeader() {
  const width = 150
  const height = 57
  const image = solidCanvas(width, height, COLD_WHITE)

  compositeImage(image, logo, 10, 10, 36, 36)
  drawTimetableGrid(image, 82, 9, 146, 49, 4, 4)
  fillRoundedRect(image, 86, 15, 101, 25, 2.5, PALE_BLUE)
  fillRoundedRect(image, 114, 31, 139, 41, 2.5, PALE_BLUE_GRAY)

  return bmp24(width, height, downsample(image, width, height))
}

function makeSidebar() {
  const width = 164
  const height = 314
  const image = solidCanvas(width, height, COOL_GRAY)

  compositeImage(image, logo, 22, 24, 46, 46)

  // The sidebar itself is the canvas: one quiet timetable fragment, no nested card.
  drawTimetableGrid(image, 22, 140, 146, 278, 4, 6)
  fillRoundedRect(image, 53, 158, 82, 178, 3.5, PALE_BLUE)
  fillRoundedRect(image, 84, 204, 116, 225, 3.5, PALE_BLUE_GRAY)
  fillRoundedRect(image, 25, 231, 50, 252, 3.5, BRAND_BLUE, 0.82)

  return bmp24(width, height, downsample(image, width, height))
}

const header = makeHeader()
const sidebar = makeSidebar()
writeFileSync(join(outDir, 'header.bmp'), header)
writeFileSync(join(outDir, 'sidebar.bmp'), sidebar)

console.log(
  `installer branding v2: real icon=${logo.width}x${logo.height}, header.bmp ${header.length} bytes, sidebar.bmp ${sidebar.length} bytes`,
)
