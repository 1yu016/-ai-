import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const { root, runId } = JSON.parse(process.env.D8_META || '{}')
const environment = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!environment.database.startsWith(root) || environment.synchronize || environment.migrationsRun) throw Error('Isolation missing')
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: path.join(root, 'd8-video') } })
await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5189' || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
await context.addInitScript(() => {
  window.__d8 = { timeline: [], audios: [] }
  window.addEventListener('classroom-dialogue-performance', event => window.__d8.timeline.push(event.detail))
  const NativeAudio = window.Audio
  window.Audio = class extends NativeAudio {
    constructor(...args) {
      super(...args); const index = window.__d8.audios.push(this) - 1
      for (const kind of ['playing', 'ended', 'pause', 'error']) this.addEventListener(kind, () => window.__d8.timeline.push({ stage: `media:${kind}`, index, atMs: performance.now() }))
    }
  }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { queueMicrotask(() => u.onerror?.({ error: 'fallback-disabled' })) } } })
})
const page = await context.newPage(), network = [], consoleLog = []
page.on('console', m => { if (['warning', 'error'].includes(m.type())) consoleLog.push({ type: m.type(), text: m.text() }) })
page.on('pageerror', e => consoleLog.push({ type: 'pageerror', text: e.message }))
page.on('request', request => { if (/\/dialogue$|\/ai\/tts$/.test(new URL(request.url()).pathname)) network.push({ path: new URL(request.url()).pathname, request: request.postData() }) })
page.on('response', response => { if (/\/dialogue$|\/ai\/tts$/.test(new URL(response.url()).pathname)) network.push({ path: new URL(response.url()).pathname, status: response.status() }) })
let status = 'failed', failure
try {
  await page.goto(`http://127.0.0.1:5189/login?redirect=${encodeURIComponent(`/classroom/lesson/${runId}`)}`)
  await page.getByPlaceholder('请输入教师账号').fill('i24b_synthetic')
  await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  const panel = page.getByRole('region', { name: '数字人课堂对话', exact: true })
  await expect(panel).toBeVisible({ timeout: 20000 })
  await panel.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
  await panel.getByRole('checkbox', { name: '逐句朗读回答' }).check()
  const ask = async text => {
    await panel.getByRole('textbox', { name: '手动课堂问题' }).fill(text)
    await panel.getByRole('button', { name: '向数字人提问', exact: true }).click()
  }
  await ask(process.env.D9_DIALOGUE_CASE || process.env.D9_REAL_SERVICE_APPROVED ? '圆形为什么会滚动？只用一个短句回答，不要追问。' : '为什么圆形会滚动？请用两句话回答。')
  await expect.poll(() => page.evaluate(() => window.__d8.timeline.filter(e => e.stage === 'media:playing').length), { timeout: 60000 }).toBeGreaterThan(0)
  await expect(page.locator('.digital-human.speaking:visible').first()).toBeVisible()
  await page.screenshot({ path: path.join(root, 'd8-first-playing.png'), fullPage: true })
  await expect(panel.locator('[data-test="dialogue-reply"]')).not.toContainText('暂时不能安全回答')
  await expect(panel.getByRole('button', { name: '停止回答与朗读', exact: true })).toBeHidden({ timeout: 60000 })
  if (process.env.D8_SYNTHETIC) {
    const measured = await page.evaluate(() => {
      const events = window.__d8.timeline
      const playing = events.find(e => e.stage === 'media:playing')
      const ended = events.find(e => e.stage === 'media:ended')
      const requests = events.filter(e => e.stage === 'tts-request')
      return { playing: playing.atMs, ended: ended.atMs, secondPrepared: requests[1]?.atMs }
    })
    // Actual media events prove overlap; a prefetched URL alone never counts as playback.
    expect(measured.secondPrepared).toBeGreaterThanOrEqual(measured.playing)
    expect(measured.secondPrepared).toBeLessThan(measured.ended)
  }
  await ask(process.env.D9_DIALOGUE_CASE || process.env.D9_REAL_SERVICE_APPROVED ? '再举一个例子，只用一个短句回答，不要追问。' : '还有什么圆形的例子？请用两句短句回答。')
  await expect.poll(() => page.evaluate(() => window.__d8.timeline.filter(e => e.stage === 'submitted').length)).toBe(2)
  await expect.poll(() => page.evaluate(() => {
    const start = window.__d8.timeline.filter(e => e.stage === 'submitted').at(-1)?.atMs
    return window.__d8.timeline.some(e => e.stage === 'media:playing' && e.atMs > start)
  }), { timeout: 60000 }).toBe(true)
  const interrupted = await page.evaluate(() => performance.now())
  await panel.getByRole('button', { name: '停止回答与朗读', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__d8.audios.every(a => a.paused))).toBe(true)
  await page.evaluate(start => window.__d8.timeline.push({ stage: 'interrupt-complete', atMs: performance.now(), durationMs: performance.now() - start }), interrupted)
  await page.screenshot({ path: path.join(root, 'd8-interrupted.png'), fullPage: true })
  const requests = network.filter(e => e.request && e.path.endsWith('/dialogue'))
  expect(requests).toHaveLength(2)
  expect(JSON.parse(requests[1].request).history.length).toBeGreaterThan(0)
  expect(consoleLog.filter(e => e.type === 'pageerror')).toEqual([])
  status = 'passed'
} catch (e) { failure = e.message; await page.screenshot({ path: path.join(root, 'd8-failure.png'), fullPage: true }).catch(() => {}) }
finally {
  const evidence = await page.evaluate(() => ({ timeline: window.__d8.timeline, audio: window.__d8.audios.map(a => ({ paused: a.paused, time: a.currentTime })) })).catch(() => ({}))
  await context.close(); await browser.close()
  fs.writeFileSync(path.join(root, 'd8-browser.json'), JSON.stringify({ status, failure, ...evidence, network, consoleLog, providerMode: environment.providerMode, scope: 'real isolated backend, synthetic questions, native browser media; provider mode above; no physical microphone/speaker' }, null, 2))
}
if (status !== 'passed') throw Error(failure)
