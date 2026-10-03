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
      // 平台模块：班级/学生/教师/教室/设备，转发到后端。
      // 这些路径同时也是前端 SPA 路由，故按 Accept 判断：
      // 浏览器整页访问返回 index.html，XHR 接口才代理到后端。
      '/teachers': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/students': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/classes': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/classrooms': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/devices': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      // 平台管理与课堂运行接口：前端默认同源请求，开发环境统一转发到后端。
      '/guardian-consents': { target: 'http://localhost:3001', changeOrigin: true },
      '/device-bindings': { target: 'http://localhost:3001', changeOrigin: true },
      '/classroom-tickets': { target: 'http://localhost:3001', changeOrigin: true },
      '/classroom-runs': { target: 'http://localhost:3001', changeOrigin: true },
      '/avatars': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
