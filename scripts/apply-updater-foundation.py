from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Could not locate expected block in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


cargo = Path("src-tauri/Cargo.toml")
cargo_text = cargo.read_text(encoding="utf-8").rstrip()
if "tauri-plugin-updater" not in cargo_text:
    cargo_text += """

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-process = "2"
tauri-plugin-updater = "2"
"""
    cargo.write_text(cargo_text + "\n", encoding="utf-8")

lib = Path("src-tauri/src/lib.rs")
needle = """        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = show_primary_experience(app) {
                eprintln!("[widget] secondary launch could not show the existing window: {error}");
            }
        }))
        .plugin(tauri_plugin_autostart::init(
"""
replacement = """        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = show_primary_experience(app) {
                eprintln!("[widget] secondary launch could not show the existing window: {error}");
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
"""
replace_once(lib, needle, replacement)

capability_path = Path("src-tauri/capabilities/default.json")
capability = json.loads(capability_path.read_text(encoding="utf-8"))
for permission in ("updater:default", "process:allow-restart"):
    if permission not in capability["permissions"]:
        capability["permissions"].append(permission)
capability_path.write_text(
    json.dumps(capability, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

settings_html = Path("settings.html")
settings_text = settings_html.read_text(encoding="utf-8")
entry = '    <script type="module" src="/src/settings.ts"></script>\n'
if "/src/updater-ui.ts" not in settings_text:
    replace_once(
        settings_html,
        entry,
        entry + '    <script type="module" src="/src/updater-ui.ts"></script>\n',
    )

Path("src/updater-ui.ts").write_text(
    """import { getVersion } from '@tauri-apps/api/app'
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
    const summary = update.body?.trim().split('\\n')[0]
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
""",
    encoding="utf-8",
)

Path("src/updater-ui.css").write_text(
    """.update-card {
  width: 100%;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line, rgba(0, 0, 0, 0.1));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  text-align: left;
}

.update-card__copy {
  min-width: 0;
}

.update-card__copy strong {
  display: block;
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
}

.update-card__copy p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #6e6e73);
  overflow-wrap: anywhere;
}

.update-card .secondary-button {
  flex: 0 0 auto;
}
""",
    encoding="utf-8",
)

Path(".github/workflows/release.yml").write_text(
    """name: Release Windows app

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm ci

      - name: Validate updater secrets
        shell: pwsh
        env:
          TAURI_UPDATER_PUBLIC_KEY: ${{ secrets.TAURI_UPDATER_PUBLIC_KEY }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
        run: |
          if ([string]::IsNullOrWhiteSpace($env:TAURI_UPDATER_PUBLIC_KEY)) { throw 'Missing TAURI_UPDATER_PUBLIC_KEY' }
          if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) { throw 'Missing TAURI_SIGNING_PRIVATE_KEY' }

      - name: Create release updater configuration
        shell: pwsh
        env:
          TAURI_UPDATER_PUBLIC_KEY: ${{ secrets.TAURI_UPDATER_PUBLIC_KEY }}
        run: |
          $config = @{
            bundle = @{ createUpdaterArtifacts = $true }
            plugins = @{
              updater = @{
                pubkey = $env:TAURI_UPDATER_PUBLIC_KEY
                endpoints = @('https://github.com/Tyr1onX/desktop-course-widget/releases/latest/download/latest.json')
                windows = @{ installMode = 'passive' }
              }
            }
          }
          $config | ConvertTo-Json -Depth 8 | Set-Content src-tauri/tauri.release.conf.json -Encoding utf8

      - name: Build and create draft release
        uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: '桌面课表 v__VERSION__'
          releaseBody: |
            Windows 安装包与应用内更新文件由 GitHub Actions 自动构建。

            发布前请补充本版本更新说明，并确认从上一公开版本升级后课表与设置仍然保留。
          releaseDraft: true
          prerelease: false
          updaterJsonPreferNsis: true
          args: --config src-tauri/tauri.release.conf.json
""",
    encoding="utf-8",
)

Path("docs").mkdir(exist_ok=True)
Path("docs/UPDATER_SETUP.md").write_text(
    """# 应用内更新发布配置

桌面课表使用 Tauri Updater 从 GitHub Releases 获取签名更新。普通本地开发构建不会连接更新源；正式 Release 由 GitHub Actions 注入更新公钥和更新地址。

## 一次性配置

1. 在可信的本机环境中运行：

   ```powershell
   npx tauri signer generate -w "$HOME/.tauri/desktop-course-widget.key"
   ```

2. 妥善备份私钥和密码。私钥不可提交到仓库，也不要粘贴到 Issue、PR 或聊天记录。
3. 在仓库 Actions secrets 中添加：
   - `TAURI_UPDATER_PUBLIC_KEY`：生成的公钥完整内容。
   - `TAURI_SIGNING_PRIVATE_KEY`：私钥完整内容。
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时设置的密码；无密码时可留空。

## 发布流程

1. 同步 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 推送 `v<版本号>` 标签，或手动运行 `Release Windows app` 工作流。
3. 工作流构建 NSIS 安装包、签名更新包并生成 `latest.json`，然后创建 Draft Release。
4. 验证从上一公开版本升级、数据保留和重新启动行为。
5. 补充更新说明并发布 Draft Release。

Windows 更新使用 `passive` 安装模式：显示简洁进度窗口，不要求用户处理旧版卸载选项，应用数据默认保留。
""",
    encoding="utf-8",
)
