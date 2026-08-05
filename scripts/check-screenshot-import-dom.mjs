import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const host = '127.0.0.1'
const port = 4179
const urls = [
  `http://${host}:${port}/scripts/screenshot-import-dom.test.html`,
  `http://${host}:${port}/scripts/runtime-capability-dom.test.html?mode=unavailable`,
  `http://${host}:${port}/scripts/runtime-capability-dom.test.html?mode=failure`,
]
const viteEntry = resolve('node_modules/vite/bin/vite.js')
const profileDir = mkdtempSync(join(tmpdir(), 'course-widget-screenshot-edge-'))
let serverOutput = ''

const server = spawn(process.execPath, [
  viteEntry,
  '--host', host,
  '--port', String(port),
  '--strictPort',
  '--logLevel', 'error',
], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString()
})

function edgePath() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before the DOM test started.\n${serverOutput}`)
    try {
      const response = await fetch(urls[0])
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for Vite.\n${serverOutput}`)
}

try {
  const browser = edgePath()
  if (!browser) throw new Error('Microsoft Edge was not found for the screenshot import DOM regression test.')
  await waitForServer()

  for (const [index, url] of urls.entries()) {
    const result = spawnSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${join(profileDir, String(index))}`,
      '--virtual-time-budget=7000',
      '--dump-dom',
      url,
    ], {
      encoding: 'utf8',
      timeout: 60_000,
    })

    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Edge exited with status ${result.status}.\n${result.stderr}`)
    if (!result.stdout.includes('data-status="pass"')) {
      throw new Error(`Screenshot import DOM regression failed for ${url}.\n${result.stdout}\n${result.stderr}`)
    }
  }

  console.log('Screenshot import capability DOM regressions passed in Microsoft Edge.')
} finally {
  server.kill()
  rmSync(profileDir, { recursive: true, force: true })
}
