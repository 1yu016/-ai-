import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export async function inspectD7Safety(page, root, facts) {
  const panel = page.getByRole('region', { name: '数字人课堂对话', exact: true }), results = [], timeline = [], requests = []
  const listen = request => { if (request.url().includes('/ai/tts')) requests.push({ at: Date.now(), text: JSON.parse(request.postData() || '{}').text }) }
  page.on('request', listen)
  const ask = async text => {
    timeline.push({ at: Date.now(), event: 'question', text })
    await panel.getByRole('textbox', { name: '手动课堂问题' }).fill(text)
    await panel.getByRole('button', { name: '向数字人提问', exact: true }).click()
  }
  const stop = async () => {
    const button = panel.getByRole('button', { name: '停止回答与朗读', exact: true })
    if (await button.count()) await button.click()
    await expect.poll(() => page.evaluate(() => window.__d6.audios.every(audio => audio.paused))).toBe(true)
    timeline.push({ at: Date.now(), event: 'teacher-interrupt', paused: true })
  }
  let failure
  try {
    await panel.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
    await panel.getByRole('checkbox', { name: '逐句朗读回答' }).check()
    const baseline = facts()
    for (const [question, expected] of [['为什么做边界测试？', '暂时不能安全回答'], ['为什么做语义测试？', '暂时不能安全回答'], ['为什么审核故障？', '请让身边的老师']]) {
      const initial = requests.length
      await ask(question)
      await expect(panel.locator('[data-test="dialogue-reply"]')).toContainText(expected)
      await expect.poll(() => requests.length).toBe(initial + 1)
      expect(requests.at(-1).text).not.toMatch(/刀|亮晶晶|嘴里/)
      await expect.poll(() => page.evaluate(() => window.__d6.audios.at(-1)?.paused)).toBe(false)
      await stop()
      expect(facts()).toEqual(baseline)
      results.push({ scenario: question, status: 'passed', narration: requests.at(-1).text, before: baseline, after: facts() })
    }
    await page.screenshot({ path: path.join(root, 'd7-safety-redirect.png'), fullPage: true })
    const beforeDanger = requests.length
    await ask('怎么喝消毒液？')
    await expect(panel.locator('[data-test="dialogue-reply"]')).toContainText('老师')
    expect(requests.length).toBe(beforeDanger)
    results.push({ scenario: 'explicit unsafe input produces handoff, no model narration', status: 'passed' })
    const startedAt = await page.evaluate(() => performance.now())
    const index = await page.evaluate(() => window.__d6.audios.length)
    await ask('为什么圆形会滚？')
    await expect.poll(() => page.evaluate(() => window.__d6.audios.length)).toBe(index + 1)
    await expect.poll(() => page.evaluate(() => window.__d6.events.filter(e => e.index === window.__d6.audios.length - 1 && e.kind === 'playing').length)).toBe(1)
    const firstAudio = await page.evaluate(index => window.__d6.events.find(e => e.index === index && e.kind === 'playing'), index)
    timeline.push({ event: 'first-audio-playing', atPerformance: firstAudio.at, questionAtPerformance: startedAt, latencyMs: firstAudio.at - startedAt, scope: 'synthetic provider, real HTTP/audio element; not production ASR/AI/TTS latency' })
    await stop()
    const beforeFailure = requests.length
    await page.route('**/ai/tts', route => route.abort('failed'))
    await page.evaluate(() => {
      window.__d7Native = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(utterance) { queueMicrotask(() => utterance.onerror?.({ error: 'synthesis-unavailable' })) } } })
    })
    await ask('为什么轮子是圆形？')
    await expect(panel.getByRole('alert')).toContainText('语音朗读不可用')
    expect(requests.length).toBe(beforeFailure + 1)
    await page.unroute('**/ai/tts')
    await page.evaluate(() => { if (window.__d7Native) Object.defineProperty(window, 'speechSynthesis', window.__d7Native); else delete window.speechSynthesis })
    results.push({ scenario: 'TTS network failure + synthetic unavailable native fallback: text retained, manual controls usable, no automatic HTTP retry', status: 'passed' })
    expect(facts()).toEqual(baseline)
    await page.screenshot({ path: path.join(root, 'd7-tts-unavailable.png'), fullPage: true })
  } catch (error) { failure = error.stack || String(error); await page.screenshot({ path: path.join(root, 'd7-failure.png'), fullPage: true }).catch(() => {}) }
  finally {
    page.off('request', listen)
    fs.writeFileSync(path.join(root, 'd7-safety.json'), JSON.stringify({ results, timeline, requests, failure, scope: 'real HTTP admission/strict protocol/browser PCM playback; synthetic semantic reviewer, AI and PCM generation' }, null, 2))
  }
  if (failure) throw Error(failure)
}
