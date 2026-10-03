import { mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const allowedRoot = resolve(projectRoot, '.tmp')
const target = resolve(allowedRoot, 'e2e')
const relativeTarget = relative(allowedRoot, target)
if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
  throw new Error(`Refusing to clean unexpected path: ${target}`)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
let status = 1
try {
  const playwrightCli = resolve(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js')
  const result = spawnSync(process.execPath, [playwrightCli, 'test'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  status = result.status ?? 1
  if (result.error) throw result.error
} finally {
  rmSync(target, { recursive: true, force: true })
}
process.exit(status)
