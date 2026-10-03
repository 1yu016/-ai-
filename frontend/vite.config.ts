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
      '/classroom-runs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/classes': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/students': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/guardian-consents': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/classrooms': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/devices': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/device-bindings': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/classroom-tickets': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/avatars': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/badge-definitions': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/reward-rules': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/break-runs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/audit-logs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ai-call-logs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
