import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const root = process.env.D3_ROOT
if (!root || !root.includes('integration-I1') || !root.includes('.tmp')) throw Error('Dedicated evidence root required')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const evidence = { scope: 'Native local language availability only, no microphone, AI or database', status: 'not-run', crashed: false }
page.on('crash', () => { evidence.crashed = true })
try {
  await page.goto('http://127.0.0.1:5189/login')
  evidence.capability = await page.evaluate(() => ({ browser: navigator.userAgent, api: typeof window.SpeechRecognition, available: typeof window.SpeechRecognition?.available, processLocally: !!window.SpeechRecognition && 'processLocally' in window.SpeechRecognition.prototype }))
  evidence.result = await page.evaluate(async () => await SpeechRecognition.available({ langs: ['zh-CN'], processLocally: true }))
  evidence.status = 'completed-capability-probe-only'
} catch (error) { evidence.status = 'blocked'; evidence.error = String(error) }
finally { fs.writeFileSync(path.join(root, 'd3-native-probe.json'), JSON.stringify(evidence, null, 2)); await browser.close() }
