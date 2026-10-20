import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const root = process.env.D3_ROOT
if (!root?.includes('integration-I1') || !root.includes('.tmp')) throw Error('Dedicated root required')
const evidence = []
for (const file of [false, true]) {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', ...(file ? [`--use-file-for-fake-audio-capture=${path.join(root, 'synthetic-teaching.wav')}`] : [])] })
  const context = await browser.newContext({ permissions: ['microphone'] })
  const page = await context.newPage()
  try {
    await page.goto('http://127.0.0.1:5189/login')
    const result = await page.evaluate(async () => {
      let stream, stage = 'getUserMedia'
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stage = 'MediaRecorder'; const recorder = new MediaRecorder(stream)
        const bytes = await new Promise((resolve, reject) => { let total = 0; const deadline = setTimeout(() => reject(Error('capture timeout')), 5000); recorder.ondataavailable = e => { total += e.data.size; if (total && recorder.state === 'recording') recorder.stop() }; recorder.onstop = () => { clearTimeout(deadline); resolve(total) }; recorder.start(200) })
        return { status: 'passed-synthetic-capture-only', stage, bytes }
      } catch (error) { return { status: 'blocked', stage, error: String(error) } }
      finally { stream?.getTracks().forEach(t => t.stop()) }
    })
    evidence.push({ file, ...result })
  } finally { await browser.close() }
}
fs.writeFileSync(path.join(root, 'd3-audio-probe.json'), JSON.stringify(evidence, null, 2))
