import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
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
