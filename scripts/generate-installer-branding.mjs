import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'installer')
mkdirSync(outDir, { recursive: true })

const SCALE = 4
const BLUE = [10, 117, 232]
const WHITE = [249, 252, 255]
const PALE = [229, 242, 255]
const GRID = [207, 227, 247]

function canvas(width, height, top, bottom) {
  const w = width * SCALE
  const h = height * SCALE
  const pixels = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    const t = y / Math.max(1, h - 1)
    const color = top.map((value, index) => Math.round(value * (1 - t) + bottom[index] * t))
    for (let x = 0; x < w; x += 1) {
      const index = (y * w + x) * 3
      pixels[index] = color[0]
      pixels[index + 1] = color[1]
      pixels[index + 2] = color[2]
    }
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
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * SCALE * 1.5))
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    fillCircle(image, x0 + dx * t, y0 + dy * t, width / 2, color, alpha)
  }
}

function drawCurve(image, points, width, color, alpha = 1) {
  for (let index = 1; index < points.length; index += 1) {
    drawLine(image, ...points[index - 1], ...points[index], width, color, alpha)
  }
}

function drawLogoMark(image, x, y, size) {
  fillRoundedRect(image, x, y, x + size, y + size, size * 0.24, BLUE)
  drawLine(
    image,
    x + size * 0.27,
    y + size * 0.31,
    x + size * 0.73,
    y + size * 0.31,
    size * 0.07,
    [255, 255, 255],
  )
  drawLine(
    image,
    x + size * 0.35,
    y + size * 0.19,
    x + size * 0.35,
    y + size * 0.36,
    size * 0.06,
    [255, 255, 255],
  )
  drawLine(
    image,
    x + size * 0.65,
    y + size * 0.19,
    x + size * 0.65,
    y + size * 0.36,
    size * 0.06,
    [255, 255, 255],
  )

  const curve = []
  for (let index = 0; index <= 28; index += 1) {
    const t = index / 28
    curve.push([
      x + size * (0.22 + 0.57 * t),
      y + size * (0.60 + 0.10 * Math.sin((t - 0.12) * Math.PI * 1.35)),
    ])
  }
  drawCurve(image, curve, size * 0.075, [255, 255, 255])
  fillCircle(image, x + size * 0.77, y + size * 0.56, size * 0.055, [255, 255, 255])
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

function makeHeader() {
  const width = 150
  const height = 57
  const image = canvas(width, height, WHITE, [237, 247, 255])

  drawLogoMark(image, 10, 10, 36)
  for (const x of [92, 108, 124, 140]) drawLine(image, x, 8, x, 49, 0.45, GRID, 0.8)
  for (const y of [20, 34, 48]) drawLine(image, 84, y, 146, y, 0.45, GRID, 0.8)

  const curve = []
  for (let index = 0; index <= 24; index += 1) {
    const t = index / 24
    curve.push([72 + 70 * t, 43 - 13 * t + 3 * Math.sin(t * Math.PI * 1.8)])
  }
  drawCurve(image, curve, 1.7, BLUE)

  return bmp24(width, height, downsample(image, width, height))
}

function makeSidebar() {
  const width = 164
  const height = 314
  const image = canvas(width, height, WHITE, PALE)

  fillCircle(image, 64, 246, 112, BLUE, 0.035)
  drawLogoMark(image, 22, 24, 44)

  // Keep the image copy-free so installer localization remains native.
  fillRoundedRect(image, 18, 150, 146, 272, 12, [255, 255, 255])
  for (const x of [46, 70, 94, 118]) drawLine(image, x, 164, x, 258, 0.55, GRID, 0.85)
  for (const y of [183, 205, 227, 249]) drawLine(image, 28, y, 136, y, 0.55, GRID, 0.85)

  fillRoundedRect(image, 50, 171, 68, 205, 4, [218, 237, 255])
  fillRoundedRect(image, 75, 218, 93, 251, 4, [231, 241, 252])
  fillRoundedRect(image, 100, 178, 118, 228, 4, [203, 228, 253])

  const curve = []
  for (let index = 0; index <= 40; index += 1) {
    const t = index / 40
    curve.push([30 + 102 * t, 249 - 50 * t + 7 * Math.sin(t * Math.PI * 2)])
  }
  drawCurve(image, curve, 2.4, BLUE)
  fillCircle(image, curve[0][0], curve[0][1], 3, BLUE)
  fillCircle(image, curve.at(-1)[0], curve.at(-1)[1], 3, BLUE)

  // Subtle status rows echo the compact widget hierarchy without embedding text.
  fillRoundedRect(image, 22, 86, 112, 93, 3.5, [164, 190, 215], 0.28)
  fillRoundedRect(image, 22, 104, 138, 110, 3, [164, 190, 215], 0.18)
  fillRoundedRect(image, 22, 119, 94, 125, 3, [164, 190, 215], 0.13)

  return bmp24(width, height, downsample(image, width, height))
}

const header = makeHeader()
const sidebar = makeSidebar()
writeFileSync(join(outDir, 'header.bmp'), header)
writeFileSync(join(outDir, 'sidebar.bmp'), sidebar)

console.log(
  `installer branding: header.bmp ${header.length} bytes, sidebar.bmp ${sidebar.length} bytes`,
)
