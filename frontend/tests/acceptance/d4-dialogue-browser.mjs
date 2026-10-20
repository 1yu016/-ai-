// Real backend HTTP/auth/state + deliberately synthetic AI provider, no paid service.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { installDialogueAudioFixture, inspectDialogueSpeech } from './d5-dialogue-speech.mjs'
import { inspectD6Audio } from './d6-review-audio.mjs'
import { inspectD7Safety } from './d7-safety-browser.mjs'
const { root, runId } = JSON.parse(process.env.D4_META || '{}')
const environment = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!environment.database.startsWith(root) || environment.synchronize || environment.migrationsRun) throw Error('Database isolation not proven')
const SQLite = createRequire(path.resolve('../backend/package.json'))('better-sqlite3')
const db = new SQLite(environment.database, { readonly: true, fileMustExist: true })
function facts() { return Object.fromEntries(['classroom_run', 'classroom_operation_record', 'classroom_event', 'classroom_snapshot'].map(table => { const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(); return [table, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }] })) }
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: path.join(root, 'd4-video') } })
if (process.env.D5_BROWSER) await context.addInitScript(installDialogueAudioFixture)
if (process.env.D6_BROWSER) await context.addInitScript(() => {
  const NativeAudio = window.Audio
  window.__d6 = { audios: [], events: [] }
  class RecognitionFixture {
    static available = async () => 'unavailable'
    get processLocally() { return true }
    set processLocally(_value) {}
    start() { window.__d6.recognizer = this; this.onstart?.() }
    abort() { window.__d6.events.push({ kind: 'synthetic.asr.abort', at: performance.now() }) }
  }
  window.SpeechRecognition = RecognitionFixture
  window.__d6.transcript = text => window.__d6.recognizer?.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] })
  window.Audio = class extends NativeAudio {
    constructor(...args) {
      super(...args)
      const index = window.__d6.audios.push(this) - 1
      for (const kind of ['playing', 'pause', 'ended', 'error', 'emptied']) this.addEventListener(kind, () => window.__d6.events.push({ index, kind, at: performance.now(), paused: this.paused, time: this.currentTime }))
    }
  }
})
await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5189' || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
const page = await context.newPage(), results = [], network = [], requests = [], consoleLog = []
page.on('request', request => {
  const pathname = new URL(request.url()).pathname
  if (/^\/(classroom-runs|classroom-commands|ai\/tts)/.test(pathname)) requests.push({ path: pathname, method: request.method(), request: request.postData() })
})
page.on('dialog', dialog => dialog.accept())
page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleLog.push({ type: message.type(), text: message.text() }) })
page.on('pageerror', error => consoleLog.push({ type: 'pageerror', text: error.message }))
page.on('response', async response => {
  const request = response.request(), pathname = new URL(response.url()).pathname
  if (!/^\/(auth|classroom-runs|classroom-commands|ai\/tts)/.test(pathname)) return
  let body, bodyReadFailed = false
  try { body = pathname.startsWith('/auth') ? '[credentials omitted]' : await response.text() } catch { body = '[aborted stream]'; bodyReadFailed = true }
  // A received 200 header is not a complete body. Preserve cancellation evidence instead
  // of parsing our own diagnostic placeholder as JSON during an intentional interrupt.
  if (pathname === '/ai/tts' && response.ok() && !bodyReadFailed) { const audio = JSON.parse(body).audioUrl; body = JSON.stringify({ audioUrlLength: audio?.length, sha256: createHash('sha256').update(audio || '').digest('hex'), source: 'test-only synthetic PCM provider' }) }
  network.push({ path: pathname, status: response.status(), method: request.method(), request: pathname.startsWith('/auth') ? '[credentials omitted]' : request.postData(), body })
})
let status = 'failed', failure
const panel = page.getByRole('region', { name: '数字人课堂对话', exact: true })
const reply = panel.locator('[data-test="dialogue-reply"]')
const ask = async text => { await panel.getByRole('textbox', { name: '手动课堂问题' }).fill(text); await panel.getByRole('button', { name: '向数字人提问', exact: true }).click() }
const screenshot = name => page.screenshot({ path: path.join(root, `d4-${name}.png`), fullPage: true })
const enable = () => panel.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
try {
  await page.goto(`http://127.0.0.1:5189/login?redirect=${encodeURIComponent(`/classroom/lesson/${runId}`)}`)
  await page.getByPlaceholder('请输入教师账号').fill('i24b_synthetic')
  await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(panel).toBeVisible({ timeout: 20000 })
  await expect(panel.getByRole('button', { name: '向数字人提问' })).toBeDisabled()
  const before = facts()
  await enable(); await ask('为什么圆形会滚？')
  await expect(reply).toContainText('圆形没有尖角。')
  await expect(panel).toContainText('数字人回答')
  await screenshot('answer')
  await ask('再讲一个故事？'); await expect(reply).toContainText('接着观察轮子')
  expect(facts()).toEqual(before)
  results.push({ scenario: 'real teacher UI, two contextual HTTP streamed questions, no classroom writes', status: 'passed', before, after: facts() })
  const posts = requests.filter(item => item.method === 'POST').length
  await ask('奖励小朋友一朵花')
  await expect(panel.locator('[data-route-kind="teacher_intent"]')).toBeVisible()
  expect(requests.filter(item => item.method === 'POST').length).toBe(posts)
  expect(facts()).toEqual(before)
  results.push({ scenario: 'public operation intent does not execute or call AI', status: 'passed' })
  await ask('为什么断网了？')
  await expect(panel.getByRole('alert')).toContainText('回答未完成')
  await screenshot('provider-error')
  results.push({ scenario: 'real HTTP with controlled upstream AI failure; partial text, no automatic retry', status: 'passed' })
  await panel.locator('summary').filter({ hasText: '麦克风与唤醒设置' }).click()
  await panel.getByRole('button', { name: '开启课堂互动', exact: true }).click()
  await expect(panel.getByRole('region', { name: '课堂唤醒与聆听', exact: true })).toHaveAttribute('data-listening-phase', 'error')
  await expect(panel.getByRole('alert').filter({ hasText: /识别|语言包/ })).toBeVisible()
  results.push({ scenario: 'unavailable ASR: explicit manual fallback', status: 'passed', limitation: process.env.D5_BROWSER ? 'synthetic unavailable language-pack result; not native microphone verification' : 'no native microphone or far-field verification' })
  // A real upstream response held at the network boundary, not a fabricated API response.
  let arrived, release
  const received = new Promise(resolve => { arrived = resolve })
  const gate = new Promise(resolve => { release = resolve })
  await context.route('**/dialogue', async route => { const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response }).catch(() => {}) })
  await ask('什么是圆形？'); await received
  await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click()
  await expect(panel.getByRole('checkbox', { name: '开启普通问题自动回答' })).not.toBeChecked()
  release(); await context.unroute('**/dialogue')
  await expect(reply).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '向数字人提问' })).toBeDisabled()
  await screenshot('paused')
  results.push({ scenario: 'real pause plus controlled late HTTP response; old answer discarded', status: 'passed' })
  await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click()
  await expect(panel.getByRole('checkbox', { name: '开启普通问题自动回答' })).not.toBeChecked()
  await enable(); await ask('为什么轮子会滚？'); await expect(reply).toContainText('圆形没有尖角。')
  await screenshot('resumed')
  results.push({ scenario: 'resume requires one explicit re-enable; valid dialogue usable again', status: 'passed' })
  if (process.env.D5_BROWSER) await inspectDialogueSpeech(page, root, facts)
  if (process.env.D6_BROWSER) await inspectD6Audio(page, root, facts)
  if (process.env.D7_BROWSER) await inspectD7Safety(page, root, facts)
  await page.getByRole('button', { name: '工作台', exact: false }).first().click()
  await expect(page).not.toHaveURL(/\/classroom\/lesson\/\d+$/)
  await page.goto(`http://127.0.0.1:5189/classroom/lesson/${runId}`)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: '开启普通问题自动回答' })).not.toBeChecked()
  results.push({ scenario: 'leave/reenter does not restart old conversation', status: 'passed' })
  expect(consoleLog.filter(item => item.type === 'pageerror')).toEqual([])
  results.push({ scenario: 'physical voice output, far-field microphone and real paid AI generation', status: 'unverified' })
  status = 'passed'
} catch (error) { failure = error.stack || String(error); await screenshot('failure').catch(() => {}) }
finally {
  await context.close(); await browser.close(); db.close()
  fs.writeFileSync(path.join(root, 'd4-browser.json'), JSON.stringify({ status, failure, results, requests, network, consoleLog, ai: 'controlled synthetic provider; real HTTP backend', audio: 'text verified, physical output not verified' }, null, 2))
}
if (status !== 'passed') throw Error(failure)
