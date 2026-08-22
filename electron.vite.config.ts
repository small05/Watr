import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          'browser-preload': resolve(__dirname, 'src/preload/browser-preload.ts'),
          'panel-preload': resolve(__dirname, 'src/preload/panel-preload.ts'),
          'navbar-preload': resolve(__dirname, 'src/preload/navbar-preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          navbar: resolve(__dirname, 'src/renderer/navbar.html')
        }
      }
    }
  }
})
