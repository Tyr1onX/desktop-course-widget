const observer = new MutationObserver(() => applyMacOSAdjustments())
observer.observe(document.body, { childList: true, subtree: true })
applyMacOSAdjustments()

function applyMacOSAdjustments(): void {
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  const excelPicker = surface?.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  const activeReview = surface?.querySelector('[data-import-course-details], .import-course-review')

  if (surface && excelPicker && !activeReview) {
    const title = surface.querySelector<HTMLElement>('.surface-intro h3')
    const copy = surface.querySelector<HTMLElement>('.surface-intro p')
    if (title) title.textContent = '从 Excel 创建独立课表'
    if (copy) {
      copy.textContent = '选择学校教务系统导出的 .xlsx 文件，检查课程后创建新课表；已有课表不会被覆盖。'
    }
  }

  const openDataButton = document.querySelector<HTMLButtonElement>('[data-action="open-data-location"]')
  if (openDataButton) {
    const note = document.createElement('p')
    note.className = 'surface-message'
    note.dataset.macosDataLocationNote = 'true'
    note.textContent = '首个 macOS 测试版暂不提供直接打开数据目录；课程和设置仍只保存在本机。'
    openDataButton.replaceWith(note)
  }
}
