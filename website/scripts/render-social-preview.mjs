import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const publicDir = resolve('docs/public')
const sourcePath = resolve(publicDir, 'social-preview.svg')
const iconPath = resolve(publicDir, 'app-icon-v2.svg')
const outputPath = resolve(publicDir, 'social-preview.png')

const [source, icon] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(iconPath, 'utf8'),
])

const iconDataUrl = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`
const inlinedSource = source.replace('href="app-icon-v2.svg"', `href="${iconDataUrl}"`)

if (inlinedSource === source) {
  throw new Error('The social preview source does not reference app-icon-v2.svg.')
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  })

  await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:640px;overflow:hidden;background:#0d0d10}svg{display:block}</style></head><body>${inlinedSource}</body></html>`)
  await page.screenshot({
    path: outputPath,
    type: 'png',
    animations: 'disabled',
    clip: { x: 0, y: 0, width: 1280, height: 640 },
  })

  const png = await readFile(outputPath)
  if (png.length < 50_000) {
    throw new Error(`Rendered social preview is unexpectedly small: ${png.length} bytes.`)
  }
  await writeFile(outputPath, png)
  console.log(`Rendered ${outputPath} (${png.length} bytes).`)
} finally {
  await browser.close()
}
