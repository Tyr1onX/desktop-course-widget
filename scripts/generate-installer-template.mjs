import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'installer')
const outPath = join(outDir, 'installer-v2.nsi')

const SOURCE_URL =
  'https://raw.githubusercontent.com/tauri-apps/tauri/tauri-bundler-v2.9.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi'
const EXPECTED_SOURCE_BLOB = 'd372e3c391770cf231db974422a1e4f8adaac3a6'
const NO_AUTO_CLOSE_DIRECTIVE = '!define MUI_FINISHPAGE_NOAUTOCLOSE'

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(buffer).digest('hex')
}

const response = await fetch(SOURCE_URL)
if (!response.ok) {
  throw new Error(`failed to fetch pinned Tauri NSIS template: HTTP ${response.status}`)
}

const sourceBuffer = Buffer.from(await response.arrayBuffer())
const sourceBlob = gitBlobSha(sourceBuffer)
if (sourceBlob !== EXPECTED_SOURCE_BLOB) {
  throw new Error(
    `pinned Tauri NSIS template changed: ${sourceBlob} != ${EXPECTED_SOURCE_BLOB}`,
  )
}

const source = sourceBuffer.toString('utf8')
const occurrences = source.split(NO_AUTO_CLOSE_DIRECTIVE).length - 1
if (occurrences !== 1) {
  throw new Error(`expected exactly one ${NO_AUTO_CLOSE_DIRECTIVE}, found ${occurrences}`)
}

const generated = source.replace(
  [
    "; Don't auto jump to finish page after installation page,",
    '; because the installation page has useful info that can be used debug any issues with the installer.',
    NO_AUTO_CLOSE_DIRECTIVE,
  ].join('\n'),
  '; Auto-advance to the finish page after a successful interactive installation.',
)

if (generated === source || generated.includes(NO_AUTO_CLOSE_DIRECTIVE)) {
  throw new Error('failed to apply the single installer finish-page patch')
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, generated, 'utf8')

console.log(
  `installer template v2: tauri-bundler-v2.9.4 blob=${sourceBlob}, patched finish-page auto-advance`,
)
