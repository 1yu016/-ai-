import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const { root, runId, recognized } = JSON.parse(process.env.D7_REAL_META || '{}')
const environment = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!environment.database.startsWith(root) || environment.synchronize || environment.migrationsRun) throw Error('Isolation missing')
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: path.join(root, 'real-video') } })
await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5189' || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
await context.addInitScript(() => {
  const NativeAudio = window.Audio; window.__d7Real = { audios: [], events: [] }
  window.Audio = class extends NativeAudio {
    constructor(...args) {
      super(...args); const index = window.__d7Real.audios.push(this) - 1
      for (const kind of ['playing', 'ended', 'pause', 'error']) this.addEventListener(kind, () => window.__d7Real.events.push({ index, kind, at: performance.now(), paused: this.paused, time: this.currentTime }))
    }
  }
  // Failure must remain a failure, never silently use a different unverified speech provider.
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(utterance) { queueMicrotask(() => utterance.onerror?.({ error: 'disabled-in-authorized-test' })) } } })
})
const page = await context.newPage(), network = [], consoleLog = [], timeline = []
page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleLog.push({ type: message.type(), text: message.text() }) })
page.on('pageerror', error => consoleLog.push({ type: 'pageerror', text: error.message }))
page.on('response', async response => {
  const pathname = new URL(response.url()).pathname
  if (!pathname.endsWith('/dialogue') && pathname !== '/ai/tts') return
  let body = ''; try { body = await response.text() } catch { body = '[cancelled]' }
  network.push({ path: pathname, status: response.status(), request: response.request().postData(), body: pathname === '/ai/tts' ? '[audio data omitted]' : body })
})
let status = 'failed', failure
try {
  await page.goto(`http://127.0.0.1:5189/login?redirect=${encodeURIComponent(`/classroom/lesson/${runId}`)}`)
  await page.getByPlaceholder('请输入教师账号').fill('i24b_synthetic'); await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  const panel = page.getByRole('region', { name: '数字人课堂对话', exact: true })
  await expect(panel).toBeVisible({ timeout: 20000 })
  await panel.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
  await panel.getByRole('checkbox', { name: '逐句朗读回答' }).check()
  const start = await page.evaluate(() => performance.now())
  await panel.getByRole('textbox', { name: '手动课堂问题' }).fill(recognized)
  await panel.getByRole('button', { name: '向数字人提问', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__d7Real.events.filter(e => e.kind === 'playing').length), { timeout: 60000 }).toBeGreaterThan(0)
  const first = await page.evaluate(() => window.__d7Real.events.find(e => e.kind === 'playing'))
  timeline.push({ event: 'first-real-TTS-playing', latencyMs: first.at - start, scope: 'real ASR transcript + real AI reviews/generation + real TTS + browser audio; no physical speaker' })
  await expect(page.locator('.digital-human.speaking:visible').first()).toBeVisible()
  await page.screenshot({ path: path.join(root, 'd7-real-speaking.png'), fullPage: true })
  expect(await panel.locator('[data-test="dialogue-reply"]').textContent()).not.toMatch(/暂时不能安全回答|先不要自己尝试/)
  // Stop actual playback promptly; detailed complete-sentence playback already has isolated PCM evidence.
  const interrupt = await page.evaluate(() => performance.now())
  await panel.getByRole('button', { name: '停止回答与朗读', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__d7Real.audios.every(a => a.paused))).toBe(true)
  timeline.push({ event: 'teacher-interrupt', controlLatencyMs: await page.evaluate(() => performance.now()) - interrupt })
  await panel.getByRole('checkbox', { name: '逐句朗读回答' }).uncheck()
  if (process.env.D7_REAL_MINIMAL !== '1') {
  await panel.getByRole('textbox', { name: '手动课堂问题' }).fill('还有别的例子吗？')
  await panel.getByRole('button', { name: '向数字人提问', exact: true }).click()
  await expect.poll(() => network.filter(r => r.path.endsWith('/dialogue') && r.body.includes('"type":"done"')).length, { timeout: 60000 }).toBe(2)
  const exchanges = network.filter(r => r.path.endsWith('/dialogue'))
  expect(JSON.parse(exchanges.at(-1).request).history.length).toBeGreaterThan(0)
  expect(exchanges.at(-1).body).toContain('"status":"approved"')
  expect(exchanges.at(-1).body).toContain('"route":"question"')
  await page.screenshot({ path: path.join(root, 'd7-real-followup.png'), fullPage: true })
  } else timeline.push({ event: 'additional-real-followup-not-executed', reason: 'preserve cumulative authorized call budget; synthetic followup passed separately' })
  expect(consoleLog.filter(r => r.type === 'pageerror')).toEqual([])
  status = 'passed'
} catch (error) { failure = error.message; await page.screenshot({ path: path.join(root, 'd7-real-failure.png'), fullPage: true }).catch(() => {}) }
finally {
  const audio = await page.evaluate(() => ({ events: window.__d7Real.events, final: window.__d7Real.audios.map(a => ({ paused: a.paused, time: a.currentTime })) })).catch(() => null)
  await context.close(); await browser.close()
  fs.writeFileSync(path.join(root, 'd7-real-browser.json'), JSON.stringify({ status, failure, recognized, network, consoleLog, timeline, audio, unverified: ['physical microphone', 'far-field echo cancellation', 'physical speaker', 'long-running load and full natural speech quality'] }, null, 2))
}
if (status !== 'passed') throw Error(failure)
