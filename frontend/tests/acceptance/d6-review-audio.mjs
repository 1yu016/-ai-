import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Real HTMLAudioElement + real isolated HTTP controller, synthetic AI and PCM TTS provider.
export async function inspectD6Audio(page, root, facts) {
  const panel = page.getByRole('region', { name: '数字人课堂对话', exact: true }), results = []
  const capture = name => page.screenshot({ path: path.join(root, `d6-${name}.png`), fullPage: true })
  const ask = async text => {
    await panel.getByRole('textbox', { name: '手动课堂问题' }).fill(text)
    await panel.getByRole('button', { name: '向数字人提问', exact: true }).click()
  }
  let release, failure
  try {
    const baseline = facts()
    await panel.getByRole('checkbox', { name: '逐句朗读回答' }).check()
    await ask('为什么轮子会滚？')
    await expect.poll(() => page.evaluate(() => window.__d6.events.filter(e => e.kind === 'playing').length)).toBe(1)
    await expect(page.locator('.digital-human.speaking:visible').first()).toBeVisible()
    await capture('actual-playing')
    await expect.poll(() => page.evaluate(() => window.__d6.events.filter(e => e.kind === 'playing').length), { timeout: 15000 }).toBe(2)
    expect(facts()).toEqual(baseline)
    results.push({ scenario: 'real HTTP TTS controller, synthetic PCM, native playing/ended, ordered sentences, zero classroom writes', status: 'passed', baseline, after: facts() })
    await panel.getByRole('button', { name: '停止回答与朗读', exact: true }).click()
    expect(await page.evaluate(() => window.__d6.audios.every(a => a.paused))).toBe(true)
    await expect(page.locator('.digital-human.speaking')).toHaveCount(0)
    results.push({ scenario: 'teacher interrupt physically pauses browser audio instance', status: 'passed' })
    const listening = panel.getByRole('region', { name: '课堂唤醒与聆听', exact: true })
    await panel.getByRole('checkbox', { name: '回答后短时免唤醒追问' }).check()
    await page.evaluate(() => { window.SpeechRecognition.available = async () => 'available' })
    await panel.getByRole('button', { name: '开启课堂互动', exact: true }).click()
    await expect(listening).toHaveAttribute('data-listening-phase', 'waiting')
    const beforeWake = await page.evaluate(() => window.__d6.audios.length)
    await page.evaluate(() => window.__d6.transcript('为什么轮子会滚？'))
    expect(await page.evaluate(() => window.__d6.audios.length)).toBe(beforeWake)
    await page.evaluate(() => window.__d6.transcript('小星小星为什么轮子会滚？'))
    await expect.poll(() => page.evaluate(() => window.__d6.audios.length)).toBe(beforeWake + 1)
    await expect(listening).toHaveAttribute('data-listening-phase', 'suspended')
    await expect(listening).toHaveAttribute('data-listening-phase', 'listening', { timeout: 15000 })
    await page.evaluate(() => window.__d6.transcript('还有呢'))
    await expect.poll(() => page.evaluate(() => window.__d6.audios.length)).toBe(beforeWake + 3)
    await expect(listening).toHaveAttribute('data-listening-phase', 'listening', { timeout: 15000 })
    await capture('followup-window')
    // Wait for the bounded real timer, not random sleeps to infer a race ordering.
    await expect(listening).toHaveAttribute('data-listening-phase', 'waiting', { timeout: 12000 })
    const afterWindow = await page.evaluate(() => window.__d6.audios.length)
    await page.evaluate(() => window.__d6.transcript('还有呢'))
    expect(await page.evaluate(() => window.__d6.audios.length)).toBe(afterWindow)
    await panel.getByRole('button', { name: '关闭课堂互动', exact: true }).click()
    results.push({ scenario: 'synthetic ASR wake/10-second followup/expiry with real browser PCM playback; no physical microphone', status: 'passed' })
    let arrived
    const reached = new Promise(resolve => { arrived = resolve }), gate = new Promise(resolve => { release = resolve })
    await page.route('**/ai/tts', async route => {
      const response = await route.fetch(); arrived(); await gate
      await route.fulfill({ response }).catch(() => {})
    })
    const count = await page.evaluate(() => window.__d6.audios.length)
    await ask('再讲一个故事？'); await reached
    await expect(panel.getByRole('button', { name: '停止回答与朗读', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '暂停课堂', exact: true }).first().click()
    await expect(panel.getByRole('checkbox', { name: '开启普通问题自动回答' })).not.toBeChecked()
    release(); await page.unroute('**/ai/tts')
    expect(await page.evaluate(() => window.__d6.audios.length)).toBe(count)
    expect(await page.evaluate(() => window.__d6.audios.every(a => a.paused))).toBe(true)
    await capture('paused-late-tts')
    results.push({ scenario: 'pause while real TTS HTTP response held at gate; no late audio created, all instances stopped', status: 'passed' })
    await page.getByRole('button', { name: '恢复课堂', exact: true }).first().click()
    expect(await page.evaluate(() => window.__d6.audios.length)).toBe(count)
    await panel.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
    await ask('为什么圆形没有角？')
    await expect.poll(() => page.evaluate(() => window.__d6.audios.length)).toBe(count + 1)
    await expect(page.locator('.digital-human.speaking:visible').first()).toBeVisible()
    await capture('resumed-new-instance')
    await page.getByRole('button', { name: '工作台', exact: false }).first().click()
    await expect(page).not.toHaveURL(/\/classroom\/lesson\/\d+$/)
    await expect.poll(() => page.evaluate(() => window.__d6.audios.every(a => a.paused))).toBe(true)
    results.push({ scenario: 'resume only new question starts playback, leaving classroom cancels real audio', status: 'passed' })
    await page.goBack(); await expect(panel).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: '开启普通问题自动回答' })).not.toBeChecked()
    results.push({ scenario: 'physical microphone/remote speaker/paid ASR and TTS/real model content quality', status: 'unverified' })
  } catch (error) { failure = error.stack || String(error); await capture('failure').catch(() => {}) }
  finally {
    release?.()
    const audio = await page.evaluate(() => ({ events: window.__d6.events, instances: window.__d6.audios.map(a => ({ paused: a.paused, ended: a.ended, readyState: a.readyState, time: a.currentTime })) })).catch(() => null)
    fs.writeFileSync(path.join(root, 'd6-audio.json'), JSON.stringify({ results, failure, audio, scope: 'real browser media element + isolated actual HTTP; synthetic AI/PCM provider, NOT physical speaker or cloud provider proof' }, null, 2))
  }
  if (failure) throw Error(failure)
}
