import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import './updater-ui.css'

const desktopRuntime = '__TAURI_INTERNALS__' in window
let currentVersion = '0.3.0'
let pendingUpdate: Update | null = null
let checking = false
let installing = false

function statusText(message: string): void {
  const target = document.querySelector<HTMLElement>('[data-update-status]')
  if (target) target.textContent = message
}

function actionButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-update-action]')
}

function resetButton(label: string): void {
  const button = actionButton()
  if (!button) return
  button.disabled = false
  button.textContent = label
}

async function checkForUpdates(): Promise<void> {
  if (!desktopRuntime || checking || installing) return
  checking = true
  pendingUpdate = null
  const button = actionButton()
  if (button) {
    button.disabled = true
    button.textContent = '正在检查…'
  }
  statusText('正在连接 GitHub Releases…')
  try {
    const update = await check({ timeout: 15_000 })
    if (!update) {
      statusText(`当前已是最新版本 ${currentVersion}`)
      resetButton('再次检查')
      return
    }
    pendingUpdate = update
    const summary = update.body?.trim().split('\n')[0]
    statusText(`发现新版本 ${update.version}${summary ? ` · ${summary}` : ''}`)
    resetButton('下载并安装')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const unconfigured = /endpoint|pubkey|configuration|configured/i.test(message)
    statusText(unconfigured ? '当前构建未启用正式更新服务' : `检查失败：${message}`)
    resetButton('重新检查')
  } finally {
    checking = false
  }
}

async function installUpdate(): Promise<void> {
  if (!pendingUpdate || installing) {
    await checkForUpdates()
    return
  }
  installing = true
  const button = actionButton()
  if (button) {
    button.disabled = true
    button.textContent = '正在更新…'
  }
  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started' || event.event === 'Progress') statusText('正在下载更新…')
      if (event.event === 'Finished') statusText('下载完成，正在安装…')
    })
    statusText('更新安装完成，正在重新启动…')
    await relaunch()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusText(`安装失败：${message}`)
    installing = false
    resetButton('重试安装')
  }
}

function enhanceAboutPanel(): void {
  const panel = document.querySelector<HTMLElement>('.about-panel')
  if (!panel || panel.dataset.updaterReady === 'true') return
  panel.dataset.updaterReady = 'true'

  const version = panel.querySelector<HTMLElement>(':scope > span')
  if (version) version.textContent = `版本 ${currentVersion}`

  const card = document.createElement('section')
  card.className = 'update-card'
  card.innerHTML = `
    <div class="update-card__copy">
      <strong>软件更新</strong>
      <p data-update-status>${desktopRuntime ? '通过 GitHub Releases 获取签名更新' : '浏览器预览不检查更新'}</p>
    </div>
    <button class="secondary-button" type="button" data-update-action${desktopRuntime ? '' : ' disabled'}>检查更新</button>
  `
  panel.append(card)
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null
  if (!target?.closest('[data-update-action]')) return
  void installUpdate()
})

const observer = new MutationObserver(enhanceAboutPanel)
observer.observe(document.documentElement, { childList: true, subtree: true })

void (async () => {
  if (desktopRuntime) {
    try {
      currentVersion = await getVersion()
    } catch (error) {
      console.warn('[updater] could not read app version', error)
    }
  }
  enhanceAboutPanel()
})()
