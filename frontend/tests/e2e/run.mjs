import { mkdirSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const backendRoot = resolve(projectRoot, '..', 'backend')
const allowedRoot = resolve(projectRoot, '.tmp')
const target = resolve(allowedRoot, 'e2e')
const relativeTarget = relative(allowedRoot, target)
if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
  throw new Error(`Refusing to clean unexpected path: ${target}`)
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function waitForServer(url, processHandle, label) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) {
      throw new Error(`${label} exited before becoming ready (code ${processHandle.exitCode})`)
    }
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // Server is still starting.
    }
    await delay(250)
  }
  throw new Error(`${label} did not become ready within 60 seconds`)
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode != null) return
  processHandle.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => processHandle.once('exit', resolveExit)),
    delay(3_000),
  ])
  if (processHandle.exitCode == null) processHandle.kill('SIGKILL')
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

let status = 1
let backendProcess
let frontendProcess
try {
  const nestCli = resolve(backendRoot, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js')
  const backendBuild = spawnSync(process.execPath, [nestCli, 'build'], {
    cwd: backendRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (backendBuild.error) throw backendBuild.error
  if (backendBuild.status !== 0) {
    throw new Error(`Backend build failed with exit code ${backendBuild.status ?? 1}`)
  }

  backendProcess = spawn(
    process.execPath,
    ['--enable-source-maps', resolve(backendRoot, 'dist', 'main.js')],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        PORT: '3001',
        DATABASE_PATH: resolve(target, 'e2e.sqlite'),
        RESOURCE_UPLOAD_ROOT_PATH: resolve(target, 'uploads'),
        RESOURCE_UPLOAD_PATH: resolve(target, 'uploads', 'resources'),
        JWT_SECRET: 'e2e-only-secret-never-use-in-production',
        JWT_EXPIRES_IN: '2h',
        TEST_TEACHER_ACCOUNT: 'e2e_teacher',
        TEST_TEACHER_PASSWORD: 'E2eTeacher123!',
        TEST_TEACHER_NAME: '端到端测试老师',
        TEST_TEACHER_ROLE: 'admin',
        TEST_TEACHER_SCHOOL_ID: 'e2e-kindergarten',
        ARK_API_KEY: 'e2e-placeholder-not-a-real-key',
        ARK_ENDPOINT_ID: 'e2e-placeholder-model',
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  await waitForServer('http://127.0.0.1:3001/', backendProcess, 'Backend')

  frontendProcess = spawn(
    process.execPath,
    [resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '4173'],
    { cwd: projectRoot, env: process.env, stdio: 'inherit', windowsHide: true },
  )
  await waitForServer('http://127.0.0.1:4173/', frontendProcess, 'Frontend')

  const playwrightCli = resolve(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js')
  const result = spawnSync(process.execPath, [playwrightCli, 'test'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  status = result.status ?? 1
  if (result.error) throw result.error
} finally {
  await stopProcess(frontendProcess)
  await stopProcess(backendProcess)
  rmSync(target, { recursive: true, force: true })
}

process.exitCode = status
