import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ai': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/emotion': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/resources': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/lesson-plans': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/lesson-runs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
