import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const backendRoot = resolve(import.meta.dirname, '..', 'backend')
const tempRoot = resolve(import.meta.dirname, '.tmp', 'e2e')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: [
    {
      command: 'npm run start',
      cwd: backendRoot,
      port: 3001,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: '3001',
        DATABASE_PATH: resolve(tempRoot, 'e2e.sqlite'),
        RESOURCE_UPLOAD_ROOT_PATH: resolve(tempRoot, 'uploads'),
        RESOURCE_UPLOAD_PATH: resolve(tempRoot, 'uploads', 'resources'),
        JWT_SECRET: 'e2e-only-secret-never-use-in-production',
        JWT_EXPIRES_IN: '2h',
        TEST_TEACHER_ACCOUNT: 'e2e_teacher',
        TEST_TEACHER_PASSWORD: 'E2eTeacher123!',
        TEST_TEACHER_NAME: '端到端测试老师',
        INITIAL_ADMIN_ACCOUNT: 'e2e_admin',
        INITIAL_ADMIN_PASSWORD: 'E2eAdmin123!',
        INITIAL_ADMIN_NAME: '端到端测试管理员',
        ARK_API_KEY: 'e2e-placeholder-not-a-real-key',
        ARK_ENDPOINT_ID: 'e2e-placeholder-model',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      cwd: import.meta.dirname,
      port: 4173,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
