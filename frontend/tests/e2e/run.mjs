import { mkdirSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { isAbsolute, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const allowedRoot = resolve(projectRoot, '.tmp')
const target = resolve(allowedRoot, `e2e-${process.pid}-${Date.now()}`)
const relativeTarget = relative(allowedRoot, target)
if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
  throw new Error(`Refusing to clean unexpected path: ${target}`)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
let status = 1
let backendProcess
let frontendProcess

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function waitFor(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${url} 服务启动失败`)
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  throw new Error(`${url} 服务启动超时`)
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  child.kill()
  await Promise.race([
    exited,
    new Promise((resolveWait) => setTimeout(resolveWait, 3000)),
  ])
  if (child.exitCode === null && process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    })
  }
}

try {
  const backendRoot = resolve(projectRoot, '..', 'backend')
  const backendPort = process.env.E2E_BACKEND_PORT || String(await freePort())
  const frontendPort = process.env.E2E_FRONTEND_PORT || String(await freePort())
  const testEnv = {
    ...process.env,
    E2E_BACKEND_PORT: backendPort,
    E2E_FRONTEND_PORT: frontendPort,
    E2E_EXTERNAL_SERVERS: '1',
  }
  const backendEnv = {
    ...testEnv,
    PORT: backendPort,
    DATABASE_PATH: resolve(target, 'e2e.sqlite'),
    RESOURCE_UPLOAD_ROOT_PATH: resolve(target, 'uploads'),
    RESOURCE_UPLOAD_PATH: resolve(target, 'uploads', 'resources'),
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
  }
  backendProcess = spawn(process.execPath, [resolve(backendRoot, 'dist', 'main.js')], {
    cwd: backendRoot,
    env: backendEnv,
    stdio: 'inherit',
  })
  frontendProcess = spawn(
    process.execPath,
    [
      resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      frontendPort,
    ],
    {
      cwd: projectRoot,
      env: {
        ...testEnv,
        VITE_BACKEND_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
      },
      stdio: 'inherit',
    },
  )
  await Promise.all([
    waitFor(`http://127.0.0.1:${backendPort}`, backendProcess),
    waitFor(`http://127.0.0.1:${frontendPort}`, frontendProcess),
  ])
  const playwrightCli = resolve(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js')
  const result = spawnSync(process.execPath, [playwrightCli, 'test'], {
    cwd: projectRoot,
    env: testEnv,
    stdio: 'inherit',
  })
  status = result.status ?? 1
  if (result.error) throw result.error
} finally {
  await stopProcess(frontendProcess)
  await stopProcess(backendProcess)
  try {
    // Windows can retain the SQLite handle briefly after taskkill returns.
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    })
  } catch (error) {
    // The next run uses a unique directory, so a delayed Windows file handle
    // cannot corrupt or block it. Keep the successful test exit status.
    console.warn(`E2E 临时目录稍后可清理：${error instanceof Error ? error.message : String(error)}`)
  }
}
process.exit(status)
