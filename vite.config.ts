import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        prototype: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
        widget: resolve(__dirname, 'widget.html'),
        settings: resolve(__dirname, 'settings.html'),
      },
    },
  },
})
