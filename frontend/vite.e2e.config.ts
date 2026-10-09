// Stage 6.6.1 临时 E2E 配置：将 API 代理指向独立 E2E 后端(3101)。用后即删，不改动 vite.config.ts。
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const E2E_API_TARGET = 'http://localhost:3101'

export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/ai': { target: E2E_API_TARGET, changeOrigin: true },
      '/auth': { target: E2E_API_TARGET, changeOrigin: true },
      '/data': { target: E2E_API_TARGET, changeOrigin: true },
      '/emotion': { target: E2E_API_TARGET, changeOrigin: true },
      '/resources': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/lesson-plans': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/lesson-runs': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/uploads': { target: E2E_API_TARGET, changeOrigin: true },
      '/teachers': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/students': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/classes': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/classrooms': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/devices': {
        target: E2E_API_TARGET,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/guardian-consents': { target: E2E_API_TARGET, changeOrigin: true },
      '/device-bindings': { target: E2E_API_TARGET, changeOrigin: true },
      '/classroom-tickets': { target: E2E_API_TARGET, changeOrigin: true },
      '/classroom-runs': { target: E2E_API_TARGET, changeOrigin: true },
      '/avatars': { target: E2E_API_TARGET, changeOrigin: true },
    },
  },
})
