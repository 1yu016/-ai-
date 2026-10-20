import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { inspectVisual, inspectTeachingSpeech } from './d2-visual.mjs'
import { inspectListening } from './d3-listening.mjs'
const { root, items } = JSON.parse(process.env.D1_META || '{}')
const env = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!env.database.startsWith(root) || env.synchronize || env.migrationsRun) throw Error('Isolation not proven')
const base = 'http://127.0.0.1:5189'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', ...(process.env.D3_BROWSER ? ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(root, 'synthetic-teaching.wav')}`] : [])] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(process.env.D2_BROWSER || process.env.D3_BROWSER ? { recordVideo: { dir: path.join(root, process.env.D3_BROWSER ? 'd3-video' : 'd2-video'), size: { width: 1440, height: 1000 } } } : {}) })
const page = await context.newPage(), scenes = [], network = [], consoleLog = []
if (process.env.D3_BROWSER) page.on('dialog', dialog => dialog.accept())
let status = 'failed', failure
await context.addInitScript(() => {
  window.d1Graphics = { deletions: 0, draws: 0 }
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue
    for (const name of ['deleteTexture', 'deleteBuffer', 'deleteProgram', 'drawElements', 'drawArrays']) {
      const original = C.prototype[name]
      C.prototype[name] = function (...args) {
        if (name.startsWith('delete')) window.d1Graphics.deletions++
        else window.d1Graphics.draws++
        return original.apply(this, args)
      }
    }
  }
})
await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
page.on('console', msg => { if (['warning', 'error'].includes(msg.type())) consoleLog.push({ type: msg.type(), text: msg.text() }) })
page.on('pageerror', error => consoleLog.push({ type: 'pageerror', text: error.message }))
page.on('response', async response => {
  const request = response.request(), url = new URL(response.url())
  if (!/^\/(avatars|classroom-runs|classroom-commands|auth|screen-preparations)/.test(url.pathname)) return
  if (/\/(src|assets)\//.test(url.pathname)) { network.push({ path: url.pathname, status: response.status(), type: 'asset' }); return }
  let body
  try { body = url.pathname.startsWith('/auth') ? '[credentials omitted]' : await response.json() } catch { body = '[non-JSON]' }
  network.push({ path: url.pathname, method: request.method(), request: url.pathname.startsWith('/auth') ? '[credentials omitted]' : request.postData(), status: response.status(), body })
})
async function login(admin = false) {
  await page.goto(`${base}/login?redirect=/avatars`)
  if (admin) await page.getByRole('button', { name: '管理员登录', exact: true }).click()
  await page.getByPlaceholder('请输入教师账号').fill(admin ? 'd1_admin' : 'i24b_synthetic')
  await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/avatars')
}
async function capture(name) { await page.screenshot({ path: path.join(root, `${name}.png`), fullPage: true }) }
const identity = character => page.locator(`.digital-human[data-avatar-character="${character}"]`)
try {
  await login(true)
  for (const [index, item] of items.entries()) {
    await page.locator('.role-card').filter({ hasText: `D1班级伙伴${index + 1}` }).click()
    const bindings = page.locator('.bindings')
    await bindings.locator('select').first().selectOption(String(item.classId))
    const submitted = page.waitForResponse(r => r.url().endsWith(`/avatars/bindings/classes/${item.classId}`) && r.request().method() === 'POST')
    await bindings.getByRole('button', { name: '设为班级默认角色', exact: true }).click()
    expect((await submitted).status()).toBe(201)
    await capture(`admin-binding-${index + 1}`)
  }
  scenes.push({ scene: 'admin binds two classes with real HTTP', status: 'passed' })
  await context.clearCookies()
  await page.evaluate(() => localStorage.clear())
  await login()
  for (const [index, item] of items.entries()) {
    await page.goto(`${base}/classroom/preflight/${item.planId}?classId=${item.classId}&classroomId=${item.classroomId}&deviceId=${item.deviceId}`)
    const prepare = page.getByRole('button', { name: '准备到大屏', exact: true })
    await expect(prepare).toBeEnabled({ timeout: 15000 }); await prepare.click()
    await page.getByRole('button', { name: '开始课堂', exact: true }).click()
    await expect(page).toHaveURL(/\/classroom\/lesson\/\d+$/)
    const opening = page.locator('[data-test="opening-overlay"]')
    await expect(opening).toBeVisible()
    await expect(identity(item.characterId).first()).toBeVisible({ timeout: 20000 })
    await expect(opening.locator('[data-render-status="ready"]')).toHaveCount(1, { timeout: 30000 })
    await capture(`opening-class-${index + 1}`)
    if (process.env.D2_BROWSER) await inspectVisual(page, root, index, 'opening')
    await opening.getByRole('button', { name: '进入教学', exact: true }).click()
    await expect(opening).toHaveCount(0)
    if (process.env.D3_BROWSER && index === 0) await inspectListening(page, root)
    await expect(page.locator('[data-test="dh-card"] .digital-human').first()).toHaveAttribute('data-avatar-character', String(item.characterId))
    await page.locator('[data-test="enter-avatar"]').click()
    await expect(page.locator('[data-test="fs-avatar"] .digital-human')).toHaveAttribute('data-avatar-character', String(item.characterId))
    await expect(page.locator('[data-test="fs-avatar"] [data-render-status="ready"]')).toBeVisible({ timeout: 30000 })
    await capture(`fullscreen-class-${index + 1}`)
    const beforeClose = await page.evaluate(() => ({ ...window.d1Graphics }))
    await page.locator('[data-test="fs-close"]').click()
    await expect.poll(() => page.evaluate(() => window.d1Graphics.deletions)).toBeGreaterThan(beforeClose.deletions)
    if (process.env.D2_BROWSER) await inspectTeachingSpeech(page, root, index)
    scenes.push({ scene: `class ${index + 1} fullscreen resource disposal`, status: 'passed', beforeClose, afterClose: await page.evaluate(() => ({ ...window.d1Graphics })) })
    await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click()
    await expect(identity(item.characterId).locator('[data-render-paused="true"]').first()).toBeVisible()
    const draws = await page.evaluate(() => window.d1Graphics.draws)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => window.d1Graphics.draws)).toBe(draws)
    await capture(`paused-class-${index + 1}`)
    await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click()
    await expect(identity(item.characterId).locator('[data-render-paused="false"]').first()).toBeVisible()
    await page.reload()
    await expect(identity(item.characterId).first()).toBeVisible()
    await expect(identity(item.characterId).locator('[data-render-status="ready"]').first()).toBeVisible({ timeout: 30000 })
    scenes.push({ scene: `class ${index + 1} opening/teaching/fullscreen/pause/resume/reload`, characterId: item.characterId, status: 'passed', graphics: await page.evaluate(() => window.d1Graphics) })
    // Controlled asset failure AFTER the backend returns the actual, authorized identity.
    await context.route('**/avatars/assets/*/content', route => route.abort('failed'))
    await page.reload()
    await expect(identity(item.characterId).first()).toBeVisible()
    await expect(identity(item.characterId).locator('[data-render-status="fallback"]').first()).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: '暂停课堂', exact: true }).first()).toBeEnabled()
    await capture(`fallback-class-${index + 1}`)
    await context.unroute('**/avatars/assets/*/content')
    scenes.push({ scene: `class ${index + 1} controlled asset failure leaves teaching usable`, status: 'passed' })
  }
  expect(consoleLog.filter(item => item.type === 'pageerror')).toEqual([])
  status = 'passed'
} catch (error) { failure = error.stack || String(error); await capture('d1-failure').catch(() => {}) }
finally {
  fs.writeFileSync(path.join(root, 'd1-browser.json'), JSON.stringify({ status, failure, scenes, network, consoleLog, graphics: await page.evaluate(() => window.d1Graphics).catch(() => null), renderer: 'Chromium WebGL, not physical screen hardware' }, null, 2))
  await browser.close()
}
if (status !== 'passed') throw Error(failure)
