const desktopRuntime = '__TAURI_INTERNALS__' in window
const isMacOSRuntime = desktopRuntime && /Macintosh|Mac OS X/i.test(navigator.userAgent)

if (isMacOSRuntime) {
  document.documentElement.dataset.desktopPlatform = 'macos'
  void import('./macos-settings-controller')
} else {
  void import('./screenshot-import-controller')
}
