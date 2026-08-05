export type SettingsWindowCloseDependencies = {
  hasUnsavedChanges: () => boolean
  confirmDiscard: () => boolean
  resetState: () => void
  hideWindow: () => Promise<void>
}

export async function requestSettingsWindowClose(
  dependencies: SettingsWindowCloseDependencies,
): Promise<boolean> {
  if (dependencies.hasUnsavedChanges() && !dependencies.confirmDiscard()) return false
  dependencies.resetState()
  await dependencies.hideWindow()
  return true
}

export type PreventableWindowCloseEvent = {
  preventDefault: () => void
}

export async function hidePresentationWindowOnClose(
  event: PreventableWindowCloseEvent,
  hideWindow: () => Promise<void>,
): Promise<void> {
  event.preventDefault()
  await hideWindow()
}
