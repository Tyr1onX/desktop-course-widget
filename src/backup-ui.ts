import { invoke } from '@tauri-apps/api/core'
import './backup-ui.css'

type BackupPreview = {
  createdAt: number
  appVersion: string
  scheduleCount: number
  courseCount: number
  activeScheduleName: string
  lessonCount: number
}

type BackupSelection = {
  fileName: string
  preview: BackupPreview
  payload: string
}

type BackupExportResult = {
  fileName: string
}

type RestoreResult = {
  scheduleCount: number
  courseCount: number
  activeScheduleName: string
}

const desktopRuntime = '__TAURI_INTERNALS__' in window
const plugin = (command: string) => `plugin:data-backup|${command}`
let selection: BackupSelection | null = null
let message = ''
let busy = false

function formatBackupTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return '时间未知'
  }
}

function renderBackupPanel(): void {
  const host = document.querySelector<HTMLElement>('.data-card')
  if (!host) return
  let panel = host.querySelector<HTMLElement>('[data-backup-panel]')
  if (!panel) {
    panel = document.createElement('section')
    panel.dataset.backupPanel = 'true'
    panel.className = 'backup-panel'
    host.append(panel)
  }

  const preview = selection?.preview
  panel.innerHTML = `
    <div class="backup-panel__intro">
      <div>
        <h4>备份与恢复</h4>
        <p>将所有课表和作息设置保存为一个本地文件。</p>
      </div>
      <div class="backup-panel__actions">
        <button class="secondary-button" type="button" data-backup-export${desktopRuntime && !busy ? '' : ' disabled'}>导出备份</button>
        <button class="secondary-button" type="button" data-backup-choose${desktopRuntime && !busy ? '' : ' disabled'}>从备份恢复</button>
      </div>
    </div>
    ${preview ? `
      <article class="backup-preview">
        <header>
          <div>
            <span>准备恢复</span>
            <strong title="${escapeHtml(selection?.fileName ?? '')}">${escapeHtml(selection?.fileName ?? '')}</strong>
          </div>
          <button type="button" data-backup-cancel aria-label="取消恢复"${busy ? ' disabled' : ''}>×</button>
        </header>
        <dl>
          <div><dt>课表</dt><dd>${preview.scheduleCount} 份</dd></div>
          <div><dt>课程</dt><dd>${preview.courseCount} 门</dd></div>
          <div><dt>当前课表</dt><dd>${escapeHtml(preview.activeScheduleName)}</dd></div>
          <div><dt>作息</dt><dd>${preview.lessonCount} 节</dd></div>
        </dl>
        <p>${formatBackupTime(preview.createdAt)} 创建 · 来自 v${escapeHtml(preview.appVersion)}</p>
        <button class="primary-button backup-restore-button" type="button" data-backup-confirm${busy ? ' disabled' : ''}>${busy ? '正在恢复…' : '确认恢复此备份'}</button>
        <small>恢复前会自动保存当前数据快照；校验失败不会覆盖现有数据。</small>
      </article>
    ` : ''}
    <p class="backup-message" role="status">${escapeHtml(message)}</p>
  `
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function exportBackup(): Promise<void> {
  if (!desktopRuntime || busy) return
  busy = true
  message = '正在整理全部课表与设置…'
  renderBackupPanel()
  try {
    const result = await invoke<BackupExportResult | null>(plugin('export_backup'))
    message = result ? `已导出 ${result.fileName}` : '已取消导出'
  } catch (error) {
    message = `导出失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy = false
    renderBackupPanel()
  }
}

async function chooseBackup(): Promise<void> {
  if (!desktopRuntime || busy) return
  busy = true
  message = '正在校验备份文件…'
  renderBackupPanel()
  try {
    const result = await invoke<BackupSelection | null>(plugin('choose_backup'))
    if (!result) {
      message = '已取消选择'
      return
    }
    selection = result
    message = '备份校验通过，请确认内容后恢复'
  } catch (error) {
    selection = null
    message = `无法使用此备份：${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy = false
    renderBackupPanel()
  }
}

async function restoreBackup(): Promise<void> {
  if (!selection || busy) return
  const confirmed = window.confirm('恢复会替换当前全部课表和作息设置。程序已准备自动快照，确定继续吗？')
  if (!confirmed) return
  busy = true
  message = '正在创建安全快照并恢复数据…'
  renderBackupPanel()
  try {
    const result = await invoke<RestoreResult>(plugin('restore_backup'), { payload: selection.payload })
    message = `已恢复 ${result.scheduleCount} 份课表，当前为“${result.activeScheduleName}”`
    selection = null
    renderBackupPanel()
    window.setTimeout(() => window.location.reload(), 700)
  } catch (error) {
    message = `恢复失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy = false
    renderBackupPanel()
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-backup-export]')) void exportBackup()
  if (target?.closest('[data-backup-choose]')) void chooseBackup()
  if (target?.closest('[data-backup-confirm]')) void restoreBackup()
  if (target?.closest('[data-backup-cancel]')) {
    selection = null
    message = '已取消恢复'
    renderBackupPanel()
  }
})

const observer = new MutationObserver(renderBackupPanel)
observer.observe(document.documentElement, { childList: true, subtree: true })
renderBackupPanel()
