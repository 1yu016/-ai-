import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Deliberately synthetic ASR/utterance events. Never claim native/physical audio acceptance.
export function installDialogueAudioFixture() {
  window.__d5 = { utterances: [], recognizers: [], timeline: [], nativeSpeech: typeof window.speechSynthesis, nativeMicrophone: !!navigator.mediaDevices?.getUserMedia }
  const record = (kind, data = {}) => window.__d5.timeline.push({ at: performance.now(), kind, ...data })
  class LocalRecognition {
    static available = async () => 'unavailable'
    get processLocally() { return true }
    set processLocally(_value) {}
    constructor() { window.__d5.recognizers.push(this) }
    start() { record('recognizer.start'); this.onstart?.() }
    abort() { record('recognizer.abort') }
  }
  window.SpeechRecognition = LocalRecognition
  window.__d5.emit = text => {
    record('synthetic.transcript', { text })
    window.__d5.recognizers.at(-1)?.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] })
  }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    cancel: () => record('synthesis.cancel'),
    speak: utterance => { window.__d5.utterances.push(utterance); record('synthesis.submitted', { text: utterance.text }) },
  } })
  window.__d5.event = (index, kind) => { record(`synthetic.${kind}`, { index }); window.__d5.utterances[index]?.[kind]?.({}) }
}

export async function inspectDialogueSpeech(page, root, facts) {
  const results = [], panel = page.getByRole('region', { name: '数字人课堂对话', exact: true })
  const listening = panel.getByRole('region', { name: '课堂唤醒与聆听', exact: true })
  const capture = name => page.screenshot({ path: path.join(root, `d5-${name}.png`), fullPage: true })
  const count = () => page.evaluate(() => window.__d5.utterances.length)
  const event = (index, kind) => page.evaluate(({ index, kind }) => window.__d5.event(index, kind), { index, kind })
  const emit = text => page.evaluate(text => window.__d5.emit(text), text)
  let status = 'failed', failure
  try {
    await panel.getByRole('checkbox', { name: '逐句朗读回答' }).check()
    await panel.getByRole('checkbox', { name: '回答后短时免唤醒追问' }).check()
    await page.evaluate(() => { window.SpeechRecognition.available = async () => 'available' })
    await panel.getByRole('button', { name: '开启课堂互动', exact: true }).click()
    await expect(listening).toHaveAttribute('data-listening-phase', 'waiting')
    const baseline = facts()
    await emit('为什么轮子会滚？')
    expect(await count()).toBe(0)
    await emit('小星小星为什么轮子会滚？')
    await expect.poll(count).toBe(1)
    await expect(listening).toHaveAttribute('data-listening-phase', 'suspended')
    expect(await page.locator('.digital-human.speaking').count()).toBe(0)
    await event(0, 'onstart')
    await expect(page.locator('.digital-human.speaking').first()).toBeVisible()
    await capture('sentence-speaking')
    await event(0, 'onend'); await expect.poll(count).toBe(2)
    await event(1, 'onstart'); await capture('next-sentence')
    await event(1, 'onend')
    await expect(listening).toHaveAttribute('data-listening-phase', 'listening')
    await expect(page.locator('.digital-human.speaking')).toHaveCount(0)
    await capture('followup-window')
    await emit('还有呢')
    await expect.poll(count).toBe(3)
    await expect(panel.locator('[data-test="dialogue-reply"]')).toContainText('接着观察')
    expect(facts()).toEqual(baseline)
    results.push({ scenario: 'wake → real HTTP streaming → synthetic utterance start/end → avatar speaking/idle → no-wake follow-up', status: 'passed', before: baseline, after: facts(), scope: 'ASR and output callbacks injected, backend/database/model rendering real; AI provider synthetic' })
    await page.getByRole('button', { name: '刷新课堂状态', exact: true }).click()
    await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click()
    await expect(listening).toHaveAttribute('data-listening-phase', 'off')
    await event(2, 'onstart'); await event(2, 'onend')
    await expect(page.locator('.digital-human.speaking')).toHaveCount(0)
    expect(await count()).toBe(3)
    await capture('paused-queue-cancelled')
    results.push({ scenario: 'real classroom pause cancels pending narration, microphone and late utterance callbacks', status: 'passed' })
    await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click()
    await expect(panel.getByRole('checkbox', { name: '开启普通问题自动回答' })).not.toBeChecked()
    expect(await count()).toBe(3)
    await panel.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
    await panel.getByRole('textbox', { name: '手动课堂问题' }).fill('为什么断网了？')
    await panel.getByRole('button', { name: '向数字人提问', exact: true }).click()
    await expect(panel.getByRole('alert').filter({ hasText: '回答未完成' })).toBeVisible()
    const stopped = await count()
    await event(stopped - 1, 'onstart'); await event(stopped - 1, 'onend')
    await expect(page.locator('.digital-human.speaking')).toHaveCount(0)
    expect(await count()).toBe(stopped)
    await capture('network-failure-stopped')
    results.push({ scenario: 'controlled provider failure cancels remaining narration without retry; manual input retained', status: 'passed' })
    results.push({ scenario: 'native ASR, physical speaker, real far-field echo and lip phonemes', status: 'unverified' })
    status = 'passed'
  } catch (error) { failure = error.stack || String(error); await capture('failure').catch(() => {}) }
  finally {
    fs.writeFileSync(path.join(root, 'd5-speech.json'), JSON.stringify({ status, failure, results, events: await page.evaluate(() => window.__d5.timeline).catch(() => []), scope: 'controlled synthetic speech events, not native audio', }, null, 2))
  }
  if (status !== 'passed') throw Error(failure)
}
