import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  define: {
    __COURSE_WIDGET_BUILD_SHA__: JSON.stringify(
      process.env.VITE_BUILD_SHA || process.env.GITHUB_SHA || 'local',
    ),
  },
  build: {
    rollupOptions: {
      input: {
        widget: resolve(__dirname, 'widget.html'),
        settings: resolve(__dirname, 'settings.html'),
        presentation: resolve(__dirname, 'presentation.html'),
      },
    },
  },
})
