// Real Vue UI in Chromium, synthetic network contract only. No backend/database/AI.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const base = 'http://127.0.0.1:5188', api = 'http://127.0.0.1:3188'
const out = path.resolve(`../../integration-I1-evidence/i2-4a-browser/run-${Date.now()}`)
fs.mkdirSync(out, { recursive: true })
if (!process.cwd().endsWith('integration-I1\\frontend')) throw Error('Wrong project')
if (!(await (await fetch(`${base}/src/api/http.ts`)).text()).includes('3188')) throw Error('Wrong API target')
if (!(await (await fetch(`${base}/src/components/classroom/operations/ArtworkReviewPanel.vue`)).text()).includes('artworkDeliveryStatus')) throw Error('Wrong frontend source')
const browser = await chromium.launch({ headless: true })
const scenes = [], requests = [], consoleLog = [], blocked = []
const run = { id: 94001, classId: 94001, deviceId: 94001, lessonPlanId: 94001, title: '合成作品验收课堂', status: 'running', version: 7, currentStepIndex: 0,
  steps: [{ stepIndex: 0, type: 'introduction', title: '合成作品环节', content: '观察图形', teacherTip: '合成提示' }], attendanceState: {}, latestSnapshotVersion: null }
const student = { id: 94001, classId: 94001, studentNo: 'SYNTH', name: '合成学生', nickname: '合成学生', status: 'active' }
const artwork = { id: 94001, studentId: 94001, classId: 94001, classroomRunId: 94001, teacherId: 94001, teacherName: '合成教师', originalName: 'synthetic.png', mimeType: 'image/png', fileUrl: '', teacherComment: null, confirmedAt: null }
try {
  for (const scenario of ['A', 'B', 'C', 'D', 'E-consent', 'E-confirm', 'F-both-failed', 'G-unknown']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const page = await context.newPage()
    let rootRequestId = '', releaseDelivery
    const deliveryGate = new Promise(resolve => { releaseDelivery = resolve })
    const envelope = (channel, status) => ({ requestId: `${rootRequestId}:${channel === 'display' ? 'display' : 'tts'}`, runId: run.id, classroomRunId: run.id, targetDeviceId: run.deviceId,
      operation: channel === 'display' ? 'display_artwork' : 'speak_text', status, result: {}, classroomState: run })
    page.on('console', m => { if (m.type() === 'error') consoleLog.push({ scenario, type: m.type(), text: m.text() }) })
    page.on('pageerror', e => consoleLog.push({ scenario, type: 'pageerror', text: e.message }))
    await context.addInitScript(() => {
      localStorage.setItem('kindergarten-ai-access-token', 'synthetic-i24a-not-real-jwt')
      localStorage.setItem('kindergarten-ai-teacher-info', JSON.stringify({ userType: 'teacher', teacherId: 94001, userId: 94001, account: 'synthetic_i24a', name: '合成教师' }))
    })
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin === base || ['blob:', 'data:'].includes(url.protocol)) return route.continue()
      if (url.origin !== api) { blocked.push({ scenario, url: req.url() }); return route.abort() }
      const entry = { scenario, method: req.method(), path: url.pathname, request: req.postData(), status: 200, response: null }
      requests.push(entry)
      const send = (response, status = 200) => {
        entry.status = status; entry.response = response
        return route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base }, body: JSON.stringify(response) })
      }
      const p = url.pathname
      if (p === '/classes') return send({ items: [{ id: 94001, name: '合成班级' }] })
      if (p === '/students') return send({ items: [student] })
      if (p.includes('consents')) return send(scenario === 'E-consent' ? [] : ['photo', 'artwork'].map((consentType, id) => ({ id, studentId: 94001, consentType, status: 'granted' })))
      if (p.endsWith('/active') || p === '/classroom-runs/94001') return send(run)
      if (p.endsWith('/cockpit')) return send({ schemaVersion: 1, run: { id: run.id, deviceId: run.deviceId }, versions: { runVersion: 7, snapshotVersion: null }, capabilities: { allowedActions: ['query', 'tts', 'reward', 'attendance_update'] } })
      if (p.endsWith('/restore')) return send({ attendanceState: {}, rewardState: {} })
      if (p.endsWith('/attendance')) return send({ attendanceState: {} })
      if (p === '/classroom-runs/94001/questions') return send([])
      if (p === '/classroom-runs/94001/artworks') return send({ artwork })
      if (p === '/ai/artwork-review') return send({ aiDraft: '合成作品用了圆形和线条。' })
      if (p === '/artworks/94001/confirm') return send({ teacherComment: JSON.parse(req.postData()).teacherComment, confirmedAt: '2026-10-19T00:00:00Z' })
      if (p === '/artworks/94001/deliver') {
        rootRequestId = JSON.parse(req.postData()).requestId
        await deliveryGate
        if (['A', 'D'].includes(scenario)) return send({ display: envelope('display', 'success'), speech: envelope('speech', 'success') })
        if (scenario === 'G-unknown') { entry.status = 'connectionfailed'; return route.abort('connectionfailed') }
        return send({ statusCode: 500, message: '合成受控投递错误（不代表两条均失败）' }, 500)
      }
      if (p.startsWith('/classroom-commands/')) {
        const channel = decodeURIComponent(p).endsWith(':display') ? 'display' : 'speech'
        if (scenario === 'G-unknown') return send({ statusCode: 404, message: '尚无可靠回执' }, 404)
        const success = scenario === 'B' ? channel === 'display' : scenario === 'C' ? channel === 'speech' : false
        return send(envelope(channel, success ? 'success' : 'failure'))
      }
      if (p === '/auth/profile') return send({ userType: 'teacher', teacherId: 94001, account: 'synthetic_i24a', name: '合成教师' })
      return send({ items: [], total: 0 })
    })
    try {
      await page.goto(`${base}/classroom/insights`)
      const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: '绘画作品评价', exact: true }) })
      await expect(panel).toBeVisible()
      await expect(panel.locator('select option[value="94001"]')).toHaveCount(1)
      await panel.locator('select').selectOption('94001')
      await panel.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=', 'base64') })
      const upload = panel.getByRole('button', { name: '上传作品', exact: true })
      if (scenario === 'E-consent') {
        await expect(upload).toBeDisabled()
        expect(requests.filter(r => r.scenario === scenario && r.method === 'POST')).toHaveLength(0)
      } else {
        await upload.click()
        await expect(panel.getByRole('button', { name: '确认并保存', exact: true })).toBeEnabled()
        if (scenario === 'E-confirm') {
          await expect(panel.getByRole('button', { name: '在大屏展示并朗读', exact: true })).toHaveCount(0)
        } else {
          await panel.getByRole('button', { name: '确认并保存', exact: true }).click()
          const deliver = panel.getByRole('button', { name: '在大屏展示并朗读', exact: true })
          await deliver.click()
          await expect(panel.getByRole('button', { name: '正在提交命令…', exact: true })).toBeDisabled()
          releaseDelivery()
          const expected = scenario === 'B' ? '作品展示：命令已提交；评价朗读：服务端返回失败' : scenario === 'C' ? '作品展示：服务端返回失败；评价朗读：命令已提交' : scenario === 'F-both-failed' ? '作品展示：服务端返回失败；评价朗读：服务端返回失败' : scenario === 'G-unknown' ? '作品展示：提交结果未知；评价朗读：提交结果未知' : '作品展示：命令已提交；评价朗读：命令已提交'
          await expect(panel.locator('.delivery-result')).toContainText(expected)
          await expect(panel.locator('.delivery-result')).toContainText('实际展示和朗读未确认')
          expect(await panel.innerText()).not.toMatch(/已送达|已播放完成|已投递到大屏/)
          await panel.getByRole('button', { name: '只查询命令结果（不重发）', exact: true }).click()
          await expect(panel.getByRole('button', { name: '只查询命令结果（不重发）', exact: true })).toBeEnabled()
          expect(requests.filter(r => r.scenario === scenario && r.path.endsWith('/deliver') && r.method === 'POST')).toHaveLength(1)
        }
      }
      await page.screenshot({ path: path.join(out, `${scenario}.png`), fullPage: true })
      scenes.push({ scenario, status: 'passed-synthetic-interface-browser', panel: await panel.innerText(), deviceActualPlayback: 'unknown', detail: scenario === 'C' ? 'Contract read-result fixture only; current sequential backend does not normally reach speech-only first execution' : scenario === 'D' ? 'Device offline/no ACK fixture; accepted command is not playback' : '' })
    } catch (error) {
      scenes.push({ scenario, status: 'failed', error: String(error) })
      await page.screenshot({ path: path.join(out, `${scenario}-failure.png`), fullPage: true })
      throw error
    } finally { releaseDelivery(); await context.close() }
  }
} finally {
  await browser.close()
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), cwd: process.cwd(), base, api, database: null, scenes, blocked, limitations: ['Synthetic HTTP interception, no real backend/JWT authorization/DB verification', 'No device ACK or real screen playback verified', 'Speech-only scenario is UI contract fixture, not proof of current sequential backend reachability'] }, null, 2))
  fs.writeFileSync(path.join(out, 'network.json'), JSON.stringify(requests, null, 2))
  fs.writeFileSync(path.join(out, 'console.json'), JSON.stringify(consoleLog, null, 2))
  console.log(JSON.stringify({ out, scenes, consoleLog }, null, 2))
}
