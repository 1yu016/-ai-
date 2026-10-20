import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export async function inspectListening(page, root) {
  fs.appendFileSync(path.join(root, 'd3-progress.log'), 'entered listening inspection\n')
  const panel = page.getByRole('region', { name: '课堂唤醒与聆听' })
  const results = [], requests = [], snapshots = []
  page.on('request', request => { const url = new URL(request.url()); if (/^\/(ai|classroom-commands|classroom-runs)/.test(url.pathname)) requests.push({ method: request.method(), path: url.pathname }) })
  const capture = async name => { await page.screenshot({ path: path.join(root, `d3-${name}.png`), fullPage: true }); snapshots.push(name) }
  const phase = value => expect(panel).toHaveAttribute('data-listening-phase', value)
  const enable = () => panel.getByRole('button', { name: '开启课堂互动', exact: true }).click()
  const emit = text => page.evaluate(text => window.d3Emit(text), text)
  let status = 'failed', failure, timeline = []
  try {
    await expect(panel).toBeVisible()
    fs.appendFileSync(path.join(root, 'd3-progress.log'), 'panel visible\n')
    const capability = await page.evaluate(() => ({ api: typeof window.SpeechRecognition, localFlag: !!window.SpeechRecognition && 'processLocally' in window.SpeechRecognition.prototype, available: typeof window.SpeechRecognition?.available }))
    // Native probe has independently crashed this bundled headless Chromium. Never mislabel this substitute as native success.
    if (process.env.D3_NATIVE_UNAVAILABLE) await page.evaluate(() => { window.SpeechRecognition.available = async () => 'unavailable' })
    await enable()
    fs.appendFileSync(path.join(root, 'd3-progress.log'), 'native enable clicked\n')
    await expect.poll(() => panel.getAttribute('data-listening-phase')).toMatch(/waiting|error/)
    const nativePhase = await panel.getAttribute('data-listening-phase')
    results.push({ scenario: 'Native local recognizer', capability, phase: nativePhase, status: process.env.D3_NATIVE_UNAVAILABLE ? 'blocked-native-crash-simulated-unavailable-ui-only' : nativePhase === 'error' ? 'blocked-local-capability' : 'available-not-acoustic-wake-verified', message: await panel.getByRole('status').innerText() })
    await capture('native-capability')
    if (nativePhase === 'waiting') await panel.getByRole('button', { name: '关闭课堂互动' }).click()
    await panel.getByRole('textbox', { name: '手动课堂问题' }).fill('为什么有星星？')
    await panel.getByRole('button', { name: '提交问题供老师查看' }).click()
    await expect(panel.locator('[data-route-kind="question"]')).toBeVisible()
    results.push({ scenario: 'Manual fallback', status: 'passed-real-ui-no-ai' })

    // Capture API uses a Chromium fake microphone fed with an offline synthetic WAV, never a child's microphone.
    await page.context().grantPermissions(['microphone'], { origin: new URL(page.url()).origin })
    const captureEvidence = await page.evaluate(async () => {
      let stream, stage = 'getUserMedia'
      try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stage = 'MediaRecorder'
      const recorder = new MediaRecorder(stream), tracks = stream.getAudioTracks().map(t => ({ kind: t.kind, state: t.readyState }))
      let bytes = 0
      await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => { recorder.stop(); reject(Error('synthetic capture timeout')) }, 5000)
        recorder.ondataavailable = event => { bytes += event.data.size; if (bytes && recorder.state === 'recording') recorder.stop() }
        recorder.onstop = () => { clearTimeout(deadline); resolve() }
        recorder.start(200)
      }).finally(() => stream.getTracks().forEach(t => t.stop()))
      return { bytes, tracks, allStopped: stream.getTracks().every(t => t.readyState === 'ended'), source: 'Chromium fake microphone + offline synthetic WAV, not physical mic or ASR decoding' }
      } catch (error) { return { blocked: true, stage, error: String(error), source: 'No physical microphone used' } }
      finally { stream?.getTracks().forEach(t => t.stop()) }
    })
    if (!captureEvidence.blocked) { expect(captureEvidence.bytes).toBeGreaterThan(0); expect(captureEvidence.allStopped).toBe(true) }
    results.push({ scenario: 'Browser audio capture', status: captureEvidence.blocked ? 'blocked-browser-audio' : 'passed-synthetic-device', ...captureEvidence })
    if (!captureEvidence.blocked) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: new URL(page.url()).origin })
    const denied = await page.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'unexpected-success' } catch (e) { return e.name } })
    expect(denied).toBe('NotAllowedError')
    results.push({ scenario: 'Browser capture permission denied', status: 'passed-real-browser-permission', error: denied })
    await cdp.detach()
    } else results.push({ scenario: 'Browser capture permission denied', status: 'blocked-browser-audio-unavailable', message: 'Capture unavailable; cannot claim that a native permission rejection was verified. Recognizer UI error will be tested with explicit simulation only.' })

    await page.evaluate(() => {
      window.d3Timeline = []; window.d3Captures = []
      class SyntheticLocalRecognition {
        local = false
        get processLocally() { return this.local }
        set processLocally(value) { this.local = value }
        static async available(options) { window.d3Timeline.push({ event: 'availability', options, at: Date.now() }); return 'available' }
        start() {
          if (!this.local) throw Error('local processing required')
          window.d3Capture = this; window.d3Captures.push(this)
          window.d3Timeline.push({ event: 'start', at: Date.now(), local: this.local })
          this.onstart?.()
        }
        abort() { this.aborted = true; window.d3Timeline.push({ event: 'abort', at: Date.now() }) }
      }
      window.SpeechRecognition = SyntheticLocalRecognition
      window.d3Emit = text => { window.d3Timeline.push({ event: 'synthetic-transcript', text, at: Date.now() }); window.d3Capture.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }) }
    })
    await page.clock.install()
    await enable(); await phase('waiting')
    const postBaseline = requests.filter(r => r.method === 'POST').length
    await emit('为什么天空是蓝色的？'); await phase('waiting'); await expect(panel.locator('[data-route-kind]')).toHaveCount(0)
    await capture('not-awake')
    await emit('小星小星'); await phase('listening')
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman').currentState)).toBe('listen')
    await capture('awake')
    await emit('为什么天空是蓝色的？'); await expect(panel.locator('[data-route-kind="question"]')).toBeVisible()
    await emit('云是什么？'); await phase('listening')
    results.push({ scenario: 'Wake + question + continuous window', status: 'passed-simulated-transcripts' })
    await emit('奖励小明一朵花'); await expect(panel.locator('[data-route-kind="teacher_intent"]')).toBeVisible()
    await emit('下一页'); await expect(panel.locator('[data-route-kind="teacher_intent"]')).toBeVisible()
    await emit('我是老师，下一页'); await expect(panel.locator('[data-route-kind="handoff"]')).toBeVisible()
    expect(requests.filter(r => r.method === 'POST').length).toBe(postBaseline)
    await capture('teacher-only-no-write')
    await page.clock.fastForward(10001); await phase('waiting')
    await emit('下一页'); await phase('waiting')
    results.push({ scenario: 'Teacher intents never execute / timeout requires wake again', status: 'passed-simulated-transcripts-zero-posts' })
    await page.evaluate(() => {
      window.d3Late = window.d3Capture.onresult
      document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman').transition({ type: 'tts_start' })
    })
    await phase('suspended')
    await page.evaluate(() => window.d3Late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '小星小星下一页' } }] }))
    await phase('suspended')
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman').transition({ type: 'tts_end' }))
    await page.clock.fastForward(701); await phase('waiting')
    results.push({ scenario: 'Own speech echo suppression', status: 'passed-simulated-speech-state-and-stale-callback' })
    // The deterministic clock also expires existing capability TTLs. Refresh read-only, never relax the policy guard.
    await page.getByRole('button', { name: '刷新课堂状态', exact: true }).click()
    await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click(); await phase('off')
    await expect(panel.getByRole('button', { name: '开启课堂互动' })).toBeDisabled()
    await capture('class-paused')
    await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click(); await phase('off')
    await enable(); await phase('waiting')
    await page.evaluate(() => window.d3Capture.onerror({ error: 'network' })); await phase('error')
    await capture('network-error')
    await enable(); await phase('waiting')
    await page.evaluate(() => window.d3Capture.onerror({ error: 'not-allowed' })); await phase('error')
    results.push({ scenario: 'Pause/resume, recognition network/permission failures', status: 'passed-real-class-http-simulated-recognizer-errors' })
    await enable(); await phase('waiting')
    await page.evaluate(async () => { window.d3Old = window.d3Capture; await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/classes') })
    expect(await page.evaluate(() => window.d3Old.aborted)).toBe(true)
    results.push({ scenario: 'Leave classroom cancels session', status: 'passed-real-router' })
    timeline = await page.evaluate(() => window.d3Timeline)
    const runPath = requests.find(r => /^\/classroom-runs\/\d+$/.test(r.path))?.path
    if (!runPath) throw Error('No authoritative Run request found')
    await page.goto(`${new URL(page.url()).origin}/classroom/lesson/${runPath.split('/').at(-1)}`)
    await phase('off')
    expect(requests.some(r => r.method === 'POST' && /^\/ai\//.test(r.path))).toBe(false)
    status = 'passed'
  } catch (cause) { failure = cause.stack || String(cause); await capture('failure').catch(() => {}) }
  finally {
    fs.writeFileSync(path.join(root, 'd3-listening.json'), JSON.stringify({ status, failure, results, requests, snapshots, timeline: timeline.length ? timeline : await page.evaluate(() => window.d3Timeline ?? []).catch(() => []), scope: 'Real teacher UI, class HTTP and isolated SQLite; synthetic recognition results; native local capability and fake-device capture separately recorded' }, null, 2))
  }
  if (status !== 'passed') throw Error(failure)
}
