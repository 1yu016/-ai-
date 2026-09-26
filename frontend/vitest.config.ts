import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/api/**/*.ts', 'src/stores/**/*.ts', 'src/components/**/*.vue', 'src/views/**/*.vue'],
      exclude: ['src/stores/counter.ts'],
    },
  },
})
