// Real isolated HTTP + browser UI; native speech callbacks are explicitly controlled.
// This proves ordering/cancellation, never actual sound or a physical speaker.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const meta = JSON.parse(process.env.D11_META || '{}')
const { root, runId, deviceId } = meta
const env = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!env.database.startsWith(root) || env.synchronize || env.migrationsRun) throw Error('Unsafe environment')
const base = 'http://127.0.0.1:5189'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: path.join(root, 'review-video') } })
await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
await context.addInitScript(() => {
  if (!location.pathname.includes('/classroom/screen/')) return
  const state = window.__d11Speech = { calls: [], events: [] }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text } } })
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak: utterance => { state.calls.push(utterance); state.events.push({ kind: 'submitted', text: utterance.text, at: performance.now() }) },
    cancel: () => state.events.push({ kind: 'cancel', at: performance.now() }),
    getVoices: () => [],
  } })
})
const network = [], consoleLog = [], pageErrors = [], scenarios = []
const teacher = await context.newPage(), screen = await context.newPage()
function watch(page, label) {
  page.on('pageerror', error => pageErrors.push({ label, message: error.message }))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleLog.push({ label, message: message.text() }) })
  page.on('response', async res => {
    if (/classroom-(commands|runs)/.test(new URL(res.url()).pathname)) network.push({ label, path: new URL(res.url()).pathname, method: res.request().method(), status: res.status(), request: res.request().postData(), response: await res.text().catch(() => 'unavailable') })
  })
}
watch(teacher, 'teacher'); watch(screen, 'screen')
const caption = screen.locator('[data-test="screen-announcement-text"]')
const speaking = screen.locator('.digital-human.speaking')
const calls = page => page.evaluate(() => window.__d11Speech.calls.map(u => u.text))
const emit = (page, index, event) => page.evaluate(({ index, event }) => { const state = window.__d11Speech; state.events.push({ kind: event, index, at: performance.now() }); state.calls[index]?.[event]?.({ error: 'synthetic-test' }) }, { index, event })
let status = 'failed', failure, second
try {
  await teacher.goto(`${base}/login?redirect=${encodeURIComponent(`/classroom/lesson/${runId}`)}`)
  await teacher.getByPlaceholder('请输入教师账号').fill('i24b_synthetic')
  await teacher.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await teacher.getByRole('button', { name: '登录', exact: true }).click()
  await expect(teacher.locator('.voice-detail')).toBeVisible({ timeout: 25000 })
  await teacher.locator('.voice-detail').click()
  const command = async (text, expected) => {
    await teacher.getByRole('textbox', { name: '课堂口令文本输入' }).fill(text)
    await teacher.getByRole('button', { name: '执行口令', exact: true }).click()
    await expect(teacher.locator('.feedback.command')).toContainText(expected, { timeout: 20000 })
  }
  await screen.goto(`${base}/classroom/screen/${deviceId}`)
  await expect(screen.locator('main.page-classroom')).toBeVisible({ timeout: 25000 })
  await command('点名合成学生', '正式点名已完成')
  await expect(caption).toHaveText('合成学生，请你来回答吧。', { timeout: 15000 })
  expect(await calls(screen)).toHaveLength(1)
  await emit(screen, 0, 'onstart')
  await expect(speaking).toHaveCount(1)
  await screen.screenshot({ path: path.join(root, 'review-speaking.png') })
  await emit(screen, 0, 'onend')
  await emit(screen, 0, 'onstart')
  await expect(speaking).toHaveCount(0)
  scenarios.push({ name: 'formal specified result + actual callback-driven state + late callback', status: 'passed' })

  await command('给合成学生一朵小红花', '奖励已正式记录')
  await expect(caption).toContainText('一朵', { timeout: 15000 })
  await command('给合成学生两朵小红花', '奖励已正式记录')
  // The second real reward is queued until the first native instance finishes.
  await expect(caption).toContainText('一朵')
  await emit(screen, 1, 'onend')
  await expect(caption).toContainText('两朵', { timeout: 15000 })
  await emit(screen, 2, 'onstart')
  await screen.screenshot({ path: path.join(root, 'review-ordered-rewards.png') })
  await emit(screen, 2, 'onend')
  expect((await calls(screen)).slice(1, 3)).toEqual(['合成学生，你真棒！得到一朵小红花。', '合成学生，你真棒！得到两朵小红花。'])
  scenarios.push({ name: 'two rapid canonical rewards remain ordered without overwriting', status: 'passed' })

  const login = await context.request.post(`${base}/auth/login`, { data: { account: 'i24b_synthetic', password: 'Synthetic24b!' } })
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}` }
  const current = async () => (await context.request.get(`${base}/classroom-runs/${runId}`, { headers })).json()
  const collective = await context.request.post(`${base}/classroom-runs/${runId}/collective-rewards`, { headers, data: { requestId: 'd11-review-collective', version: (await current()).version, points: 3, rewardCategory: 'cooperation', reason: '一起合作' } })
  expect(collective.ok()).toBe(true)
  await expect(caption).toContainText('三点', { timeout: 15000 })
  await emit(screen, 3, 'onend')
  await teacher.reload(); await expect(teacher.locator('.voice-detail')).toBeVisible(); await teacher.locator('.voice-detail').click()

  await command('随机点名', '正式点名已完成')
  await expect.poll(async () => (await calls(screen)).length).toBe(5)
  await command('播放当前资源', '提交成功')
  await screen.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > 0 })
  await emit(screen, 4, 'onstart')
  await expect(speaking).toHaveCount(0)
  await expect(caption).toHaveCount(0)
  await command('停止播放', '提交成功')
  await expect.poll(async () => screen.evaluate(() => document.querySelector('audio')?.paused)).toBe(true)
  expect(await calls(screen)).toHaveLength(5)
  scenarios.push({ name: 'pending speech loses to actual WAV playback; late start and media stop do not revive it', status: 'passed', audio: 'test-owned sine WAV, not TTS' })

  await command('点名合成学生', '正式点名已完成')
  await expect.poll(async () => (await calls(screen)).length).toBe(6)
  await emit(screen, 5, 'onstart')
  await command('暂停课堂', '提交成功')
  await expect(caption).toHaveCount(0)
  await emit(screen, 5, 'onend'); await emit(screen, 5, 'onstart')
  await expect(speaking).toHaveCount(0)
  await command('恢复课堂', '提交成功')
  expect(await calls(screen)).toHaveLength(6)
  scenarios.push({ name: 'pause/resume never revives cancelled native callbacks', status: 'passed' })

  const checkpoint = page => page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname === `/classroom-runs/${runId}/checkpoints`, { timeout: 12000 })
  const firstRestored = checkpoint(screen)
  await screen.reload(); await expect(screen.locator('main.page-classroom')).toBeVisible()
  expect((await firstRestored).ok()).toBe(true)
  expect(await calls(screen)).toEqual([])
  second = await context.newPage(); watch(second, 'second-screen')
  const secondRestored = checkpoint(second)
  await second.goto(`${base}/classroom/screen/${deviceId}`)
  await expect(second.locator('main.page-classroom')).toBeVisible()
  expect((await secondRestored).ok()).toBe(true)
  expect(await calls(second)).toEqual([])
  // Restoration feedback legitimately advances the authoritative version. Read it
  // through the existing teacher refresh path before issuing a new command.
  await teacher.reload(); await expect(teacher.locator('.voice-detail')).toBeVisible(); await teacher.locator('.voice-detail').click()
  await command('给合成学生两朵小红花', '奖励已正式记录')
  await expect.poll(async () => (await calls(screen)).length).toBe(1)
  await expect.poll(async () => (await calls(second)).length).toBe(1)
  scenarios.push({ name: 'reload baseline; two independent tabs may each announce a new record', status: 'passed', semantics: 'per tab, not per-device/global exactly-once' })
  await screen.screenshot({ path: path.join(root, 'review-two-tabs.png') })
  expect(pageErrors).toEqual([])
  status = 'passed'
} catch (error) {
  failure = String(error.stack || error)
  await screen.screenshot({ path: path.join(root, 'review-failed.png') }).catch(() => {})
} finally {
  const speechEvents = await screen.evaluate(() => window.__d11Speech?.events).catch(() => [])
  await context.close(); await browser.close()
  fs.writeFileSync(path.join(root, 'd11-browser.json'), JSON.stringify({ status, failure, scenarios, network, consoleLog, pageErrors, speechEvents, scope: 'real backend/SQLite/HTTP/UI; explicitly injected native speech callbacks; no sound/hardware assertion' }, null, 2))
}
if (status !== 'passed') throw Error(failure)
