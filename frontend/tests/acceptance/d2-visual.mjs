import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function inspectVisual(page, root, index, phase) {
  const samples = []
  const read = () => page.evaluate(() => {
    const avatar = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman')
    return { at: Date.now(), action: avatar.action, state: avatar.currentState, identity: avatar.identity, paused: avatar.renderingPaused, graphics: { ...window.d1Graphics } }
  })
  if (phase === 'opening') {
    // Frame sequence documents actual rendered motion, not only a static success label.
    for (let i = 0; i < 4; i++) {
      samples.push(await read())
      await page.screenshot({ path: path.join(root, `d2-${index}-${phase}-${i}.png`) })
      await page.waitForTimeout(120) // sampling interval only; concurrency is covered by controlled unit tests
    }
  } else {
    // Explicit render-adapter events are synthetic; class identity/phase/permissions remain real HTTP.
    for (const event of [{ type: 'teacher_command', command: 'listen' }, { type: 'tts_start' }, { type: 'tts_end' }, { type: 'ai_response', emotion: 'encourage' }]) {
      await page.evaluate(event => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman').transition(event), event)
      for (let i = 0; i < 4; i++) {
        samples.push({ event, ...await read() })
        await page.screenshot({ path: path.join(root, `d2-${index}-${event.type}-${i}.png`) })
        await page.waitForTimeout(120)
      }
    }
    expect(samples.find(s => s.event?.type === 'tts_start')?.action).toBe('talk')
    expect(samples.find(s => s.event?.type === 'tts_end')?.action).toBe('idle')
  }
  fs.writeFileSync(path.join(root, `d2-${index}-${phase}-timeline.json`), JSON.stringify({ scope: 'Real backend identity and classroom; synthetic visual events, no speech-output claim', samples }, null, 2))
}

export async function inspectTeachingSpeech(page, root, index) {
  // Offline OS-generated test speech. AI endpoints alone are intercepted; authorization is real CommandBus HTTP.
  const audioUrl = `data:audio/wav;base64,${fs.readFileSync(path.join(root, 'synthetic-teaching.wav')).toString('base64')}`
  await page.route('**/ai/classroom-assistant', route => route.fulfill({ json: { mode: 'guided_dialogue', ability: 'guided_question', reply: 'Welcome to our classroom. Let us observe the shapes together.', teacherTip: 'Offline synthetic acceptance only', requiresTeacherConfirmation: false } }))
  await page.route('**/ai/tts', route => route.fulfill({ json: { audioUrl } }))
  await page.evaluate(() => {
    window.d2Audio = []; window.d2AudioEvents = []
    const NativeAudio = window.Audio
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args)
      window.d2Audio.push(audio)
      for (const event of ['playing', 'pause', 'ended', 'error']) audio.addEventListener(event, () => window.d2AudioEvents.push({ event, at: Date.now(), paused: audio.paused, time: audio.currentTime }))
      return audio
    }
    window.Audio.prototype = NativeAudio.prototype
  })
  await page.locator('.quick-actions button').filter({ hasText: 'AI教学伙伴' }).click()
  const open = page.getByRole('button', { name: '打开助教', exact: true })
  if (await open.isVisible()) await open.click()
  await page.getByPlaceholder('输入老师想让助教回答的问题或课堂要求').fill('Please welcome our synthetic classroom and introduce shapes.')
  await page.getByRole('button', { name: '生成AI草稿', exact: true }).click()
  await page.getByRole('button', { name: '教师确认并播放', exact: true }).click()
  await page.waitForFunction(() => window.d2Audio.some(audio => !audio.paused && audio.currentTime > 0))
  const samples = []
  for (let frame = 0; frame < 6; frame++) {
    samples.push(await page.evaluate(() => ({ at: Date.now(), action: document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman').action, audio: window.d2Audio.map(a => ({ paused: a.paused, time: a.currentTime })) })))
    await page.screenshot({ path: path.join(root, `d2-speech-${index}-${frame}.png`) })
    await page.waitForTimeout(120)
  }
  expect(samples.every(s => s.action === 'talk')).toBe(true)
  await page.getByRole('button', { name: '暂停播放', exact: true }).click()
  expect(await page.evaluate(() => window.d2Audio.every(a => a.paused))).toBe(true)
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('digitalHuman').action)).toBe('idle')
  await page.getByRole('button', { name: '取消播放', exact: true }).click()
  const drawerClose = page.locator('.el-drawer:visible .el-drawer__close-btn')
  if (await drawerClose.count()) await drawerClose.click()
  fs.writeFileSync(path.join(root, `d2-speech-${index}.json`), JSON.stringify({ status: 'passed', scope: 'Real HTTP command authorization; synthetic AI text and offline Windows SAPI speech via intercepted TTS response; real HTMLAudioElement; physical speaker not verified', samples, events: await page.evaluate(() => window.d2AudioEvents) }, null, 2))
}
