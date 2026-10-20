import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(`../../integration-I1-evidence/i2-3b-browser/run-${Date.now()}`)
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:5187', api = 'http://127.0.0.1:3187'
const health = await (await fetch(`${api}/__acceptance/health`)).json()
if (health.fixture !== 'i2-3b' || health.database !== null || !health.cwd.endsWith('integration-I1\\frontend')) throw Error('Isolation preflight failed')
const module = await (await fetch(`${base}/src/api/http.ts`)).text()
if (!module.includes('3187')) throw Error('Frontend API target mismatch')
const component = await (await fetch(`${base}/src/views/LessonClassroomView.vue`)).text()
if (!component.includes('useTeachingSpeech')) throw Error('Wrong frontend build')
await fetch(`${api}/__acceptance/control`, { method: 'POST', body: JSON.stringify({ reset: true }) })
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const results = [], consoleLog = [], network = [], eventBatches = [], blockedRequests = []
await context.route('**/*', route => {
  const url = route.request().url()
  if (url.startsWith(`${base}/`) || url.startsWith(`${api}/`) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue()
  blockedRequests.push(url)
  return route.abort('blockedbyclient')
})
page.on('dialog', dialog => dialog.accept())
page.on('console', msg => consoleLog.push({ type: msg.type(), text: msg.text() }))
page.on('pageerror', error => consoleLog.push({ type: 'pageerror', text: error.message }))
page.on('response', async response => {
  if (!response.url().startsWith(api)) return
  const request = response.request()
  const item = { url: response.url(), method: request.method(), status: response.status(), request: request.postData() }
  try { if (response.headers()['content-type']?.includes('json')) item.response = await response.json() } catch { /* interrupted test request */ }
  network.push(item)
})
await context.addInitScript(() => {
  localStorage.setItem('kindergarten-ai-access-token', 'i23b-synthetic-test-token-not-production')
  localStorage.setItem('kindergarten-ai-teacher-info', JSON.stringify({ teacherId: 93001, userId: 93001, userType: 'teacher', account: 'i23b_synthetic', name: '合成验收教师' }))
  window.__teachingAudio = []; window.__audioEvents = []
  const NativeAudio = window.Audio
  function TrackedAudio(...args) {
    const audio = new NativeAudio(...args), id = window.__teachingAudio.length
    window.__teachingAudio.push(audio)
    for (const event of ['play', 'playing', 'pause', 'ended', 'emptied', 'error']) audio.addEventListener(event, () => window.__audioEvents.push({ id, event, paused: audio.paused, currentTime: audio.currentTime, src: audio.getAttribute('src'), native: audio instanceof HTMLAudioElement }))
    return audio
  }
  TrackedAudio.prototype = NativeAudio.prototype
  window.Audio = TrackedAudio
})
const audioState = () => page.evaluate(() => window.__teachingAudio.map((a, id) => ({ id, paused: a.paused, currentTime: a.currentTime, src: a.getAttribute('src'), native: a instanceof HTMLAudioElement })))
const screenshot = name => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true })
const closeDrawer = async () => { const close = page.locator('.el-drawer:visible .el-drawer__close-btn'); if (await close.count()) await close.click() }
const openAssistant = async () => {
  await page.locator('.quick-actions button').filter({ hasText: 'AI教学伙伴' }).click()
  const open = page.getByRole('button', { name: '打开助教', exact: true }); if (await open.isVisible()) await open.click()
}
const generate = async () => { await page.getByRole('button', { name: '生成启发问题', exact: true }).click(); await expect(page.getByRole('button', { name: '教师确认并播放', exact: true })).toBeEnabled() }
const start = async () => { const count = (await audioState()).length; await page.getByRole('button', { name: '教师确认并播放', exact: true }).click(); await page.waitForFunction(n => window.__teachingAudio.length > n && !window.__teachingAudio.at(-1).paused && window.__teachingAudio.at(-1).currentTime > 0, count); return count }
try {
  await page.goto(`${base}/classroom/lesson/93001`)
  await expect(page.getByText('I-2-3B 合成语音课堂', { exact: false }).first()).toBeVisible()
  await openAssistant(); await generate(); const first = await start()
  await screenshot('A-teaching-playing'); results.push({ scenario: 'A', status: 'passed-browser-fixture', audio: await audioState() })

  // Local pause first preserves a real resume button; then the authoritative classroom pause invalidates it.
  await page.getByRole('button', { name: '暂停播放', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'AI教学伙伴' }).getByRole('button', { name: '继续播放', exact: true })).toBeVisible()
  await page.getByRole('dialog', { name: 'AI教学伙伴' }).getByRole('button', { name: '继续播放', exact: true }).click()
  await page.waitForFunction(() => !window.__teachingAudio.at(-1).paused)
  await closeDrawer(); await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click()
  await page.waitForFunction(i => window.__teachingAudio[i].paused && !window.__teachingAudio[i].getAttribute('src'), first)
  await screenshot('B-classroom-paused'); results.push({ scenario: 'B', status: 'passed-browser-fixture', audio: await audioState() })
  await openAssistant()
  await expect(page.getByRole('button', { name: '教师确认并播放', exact: true })).toBeDisabled()
  await expect(page.getByRole('dialog', { name: 'AI教学伙伴' }).getByRole('button', { name: '继续播放', exact: true })).toHaveCount(0)
  await screenshot('C-resume-unavailable'); results.push({ scenario: 'C', status: 'passed-browser-fixture', detail: 'Old instance cancelled; resume entry removed, play disabled', audio: await audioState() })

  await closeDrawer(); await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click()
  await openAssistant(); await expect(page.getByRole('button', { name: '教师确认并播放', exact: true })).toBeEnabled()
  if ((await audioState()).length !== first + 1 || !(await audioState())[first].paused) throw Error('Old audio replayed automatically')
  const fresh = await start(); await screenshot('D-new-instance-playing'); results.push({ scenario: 'D', status: 'passed-browser-fixture', audio: await audioState() })
  await closeDrawer(); await page.getByRole('button', { name: '进入下一环节', exact: true }).click()
  await page.waitForFunction(i => window.__teachingAudio[i].paused && !window.__teachingAudio[i].getAttribute('src'), fresh)
  await screenshot('E-step-change-stopped'); results.push({ scenario: 'E-step', status: 'passed-browser-fixture', audio: await audioState() })
  await openAssistant(); await generate(); const exiting = await start(); await closeDrawer()
  await page.getByRole('button', { name: '← 工作台', exact: true }).click()
  await page.waitForFunction(i => window.__teachingAudio[i].paused, exiting)
  await screenshot('E-route-exit-stopped'); results.push({ scenario: 'E-exit', status: 'passed-browser-fixture', audio: await audioState() })
  eventBatches.push({ scenes: 'A-E', events: await page.evaluate(() => window.__audioEvents) })
  await page.goto(`${base}/classroom/lesson/93001`)
  await openAssistant(); await generate()
  await fetch(`${api}/__acceptance/control`, { method: 'POST', body: JSON.stringify({ holdTts: true }) })
  await page.getByRole('button', { name: '教师确认并播放', exact: true }).click()
  await expect.poll(async () => (await (await fetch(`${api}/__acceptance/control`, { method: 'POST', body: '{}' })).json()).pending).toBe(1)
  await closeDrawer(); await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '恢复课堂', exact: true }).first()).toBeEnabled()
  await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click()
  const lateResponse = page.waitForResponse(r => r.url().endsWith('/ai/tts'))
  await fetch(`${api}/__acceptance/control`, { method: 'POST', body: JSON.stringify({ releaseTts: true }) })
  await (await lateResponse).finished()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  if ((await audioState()).length !== 0) throw Error('Late TTS started after pause/resume')
  await screenshot('F-late-tts-discarded'); results.push({ scenario: 'F-controlled-late-TTS', status: 'passed-browser-fixture', audio: await audioState() })
} catch (error) {
  results.push({ status: 'failed', message: String(error), url: page.url() }); await screenshot('failure')
  process.exitCode = 1
} finally {
  const events = await page.evaluate(() => window.__audioEvents ?? []).catch(() => [])
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ health, results, blockedRequests, allowedOrigins: [base, api], events: [...eventBatches, { scenes: 'final', events }], limitations: ['Synthetic HTTP contract fixture, not real canonical backend acceptance', 'Synthetic tone returned instead of real model TTS', 'Native HTMLAudioElement verified; physical loudspeaker not verified', 'Headless autoplay policy relaxed for deterministic instance checks'] }, null, 2))
  fs.writeFileSync(path.join(out, 'console.json'), JSON.stringify(consoleLog, null, 2))
  fs.writeFileSync(path.join(out, 'network.json'), JSON.stringify(network, null, 2))
  console.log(JSON.stringify({ out, results, consoleErrors: consoleLog.filter(e => ['error', 'pageerror'].includes(e.type)) }, null, 2))
  await browser.close()
}
