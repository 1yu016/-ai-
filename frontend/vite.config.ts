import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue({
      // 仅识别第三方 Web Component <agent-robot-avatar>（Agent Robot Avatar），
      // 不要写成「所有带 - 的标签都是 Custom Element」，避免影响其他 Vue 组件。
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag === 'agent-robot-avatar',
        },
      },
    }),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ai': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/auth': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/data': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/emotion': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/resources': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/lesson-plans': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/lesson-runs': {
        target: backendProxyTarget,
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
        target: backendProxyTarget,
        changeOrigin: true,
      },
      // 平台模块：班级/学生/教师/教室/设备，转发到后端。
      // 这些路径同时也是前端 SPA 路由，故按 Accept 判断：
      // 浏览器整页访问返回 index.html，XHR 接口才代理到后端。
      '/teachers': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/students': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/classes': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/classrooms': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/devices': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      // 平台管理与课堂运行接口：前端默认同源请求，开发环境统一转发到后端。
      '/guardian-consents': { target: backendProxyTarget, changeOrigin: true },
      '/device-bindings': { target: backendProxyTarget, changeOrigin: true },
      '/classroom-tickets': { target: backendProxyTarget, changeOrigin: true },
      '/classroom-runs': { target: backendProxyTarget, changeOrigin: true },
      '/classroom-commands': { target: backendProxyTarget, changeOrigin: true },
      '/classroom-mobile': { target: backendProxyTarget, changeOrigin: true },
      '/artworks': { target: backendProxyTarget, changeOrigin: true },
      '/admin': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
      '/avatars': {
        target: backendProxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          request.headers.accept?.includes('text/html')
            ? '/index.html'
            : undefined,
      },
    },
  },
})
