// Real test backend only. No fulfilled synthetic API responses.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const meta = JSON.parse(process.env.I24B_META || '{}')
const { root, mode, studentId } = meta
const base = 'http://127.0.0.1:5189'
const environment = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!environment.database.startsWith(root) || environment.synchronize || environment.migrationsRun || environment.backendPort !== 3189 || !environment.cwd.endsWith('integration-I1\\backend')) throw Error('Backend isolation not proven')
if (!process.cwd().endsWith('integration-I1\\frontend')) throw Error('Wrong frontend')
const source = await (await fetch(`${base}/src/api/http.ts`)).text()
if (source.includes('http://127.0.0.1:3188')) throw Error('Stale fixture frontend')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
const network = [], consoleLog = [], blocked = []
const requireBackend = createRequire(path.resolve('../backend/package.json'))
const SQLite = requireBackend('better-sqlite3')
const evidenceDb = new SQLite(environment.database, { readonly: true, fileMustExist: true })
const databaseEvidence = () => Object.fromEntries(environment.evidenceTables.map(table => {
  const rows = evidenceDb.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()
  return [table, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
}))
let readOnlyBefore = null, readOnlyAfter = null
let queryAllowed = mode !== 'D-response-loss', deliveryId = '', unknownObserved = false, status = 'failed', error = null, revokedAttempt = null
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) { blocked.push(req.url()); return route.abort() }
  if (url.origin !== base || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/') || url.pathname.startsWith('/@') || url.pathname.startsWith('/__') || /\.(js|css|png|svg|woff2?)(\?|$)/.test(url.pathname) || req.isNavigationRequest()) return route.continue()
  if (!/^\/(auth|artworks|classroom-runs|classroom-commands|students|classes|guardian-consents|ai|resources|avatars|teacher|question)/.test(url.pathname)) return route.continue()
  const item = { method: req.method(), path: url.pathname, request: req.postData(), status: null, response: null }
  if (url.pathname.startsWith('/auth/')) item.request = '[synthetic credentials/tokens omitted]'
  network.push(item)
  if (url.pathname.startsWith('/classroom-commands/') && !queryAllowed) { item.status = 'blocked-for-response-loss-test'; return route.abort('connectionfailed') }
  try {
    const response = await route.fetch()
    item.status = response.status()
    try { item.response = url.pathname.startsWith('/auth/') ? '[tokens omitted]' : await response.json() } catch { item.response = '[non-JSON body]' }
    if (url.pathname.endsWith('/deliver')) {
      deliveryId = JSON.parse(req.postData()).requestId
      if (mode === 'D-response-loss') { item.clientResponse = 'intentionally lost AFTER real response'; return route.abort('connectionfailed') }
    }
    return route.fulfill({ response })
  } catch (cause) { item.transportError = String(cause); return route.abort() }
})
page.on('console', m => { if (m.type() === 'error') consoleLog.push({ type: m.type(), text: m.text() }) })
page.on('pageerror', e => consoleLog.push({ type: 'pageerror', text: e.message }))
try {
  await page.goto(`${base}/login?redirect=/classroom/insights`)
  await page.getByPlaceholder('请输入教师账号').fill('i24b_synthetic')
  await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/classroom\/insights/)
  const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: '绘画作品评价', exact: true }) })
  await expect(panel).toBeVisible()
  await expect(panel.locator(`select option[value="${studentId}"]`)).toHaveCount(1)
  await panel.locator('select').selectOption(String(studentId))
  await panel.locator('input[type=file]').setInputFiles({ name: `i24b-${mode}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=', 'base64') })
  if (mode === 'C-no-consent') {
    await expect(panel.getByRole('button', { name: '上传作品', exact: true })).toBeDisabled()
  } else {
    await panel.getByRole('button', { name: '上传作品', exact: true }).click()
    const comment = panel.locator('textarea')
    await expect(comment).toBeVisible() // Actual vision service 503; teacher still edits.
    await comment.fill('我看到圆形和线条，请介绍你的作品。')
    if (mode === 'C-no-confirm') {
      await expect(panel.getByRole('button', { name: '在大屏展示并朗读', exact: true })).toHaveCount(0)
    } else {
      await panel.getByRole('button', { name: '确认并保存', exact: true }).click()
      if (mode === 'C-revoke-after-confirm') {
        const jwt = await page.evaluate(() => localStorage.getItem('kindergarten-ai-access-token'))
        const headers = { Authorization: `Bearer ${jwt}` }
        const confirmed = network.findLast(n => n.method === 'POST' && /\/artworks\/\d+\/confirm$/.test(n.path))
        const artworkId = Number(confirmed.path.split('/')[2])
        const revoked = await page.request.post(`${base}/guardian-consents`, { headers, data: { studentId, consentType: 'artwork', status: 'revoked' } })
        expect(revoked.status()).toBe(201)
        readOnlyBefore = databaseEvidence()
        await panel.getByRole('button', { name: '在大屏展示并朗读', exact: true }).click()
        await expect(panel.locator('.delivery-result')).toContainText('未发送展示或朗读命令')
        const current = await (await page.request.get(`${base}/classroom-runs/${meta.runId}`, { headers })).json()
        const payload = { requestId: `i24c-browser-revoked-${artworkId}`, deviceId: meta.deviceId, targetDeviceId: meta.deviceId, expectedVersion: current.version, source: 'teacher_panel' }
        const rejected = await page.request.post(`${base}/artworks/${artworkId}/deliver`, { headers, data: payload })
        revokedAttempt = { revokeStatus: revoked.status(), request: payload, status: rejected.status(), response: await rejected.json() }
        expect(rejected.status()).toBe(403)
        readOnlyAfter = databaseEvidence(); expect(readOnlyAfter).toEqual(readOnlyBefore)
        await page.screenshot({ path: path.join(root, `${mode}.png`), fullPage: true })
        status = 'passed'
      } else {
      await panel.getByRole('button', { name: '在大屏展示并朗读', exact: true }).click()
      const result = panel.locator('.delivery-result')
      if (mode === 'D-response-loss') {
        await expect(result).toContainText('作品展示：提交结果未知；评价朗读：提交结果未知')
        unknownObserved = true
        await page.screenshot({ path: path.join(root, `${mode}-unknown.png`), fullPage: true })
        queryAllowed = true
      }
      const expected = mode === 'B' || mode === 'B-revoked-between' ? '作品展示：命令已提交；评价朗读：提交结果未知' : '作品展示：命令已提交；评价朗读：命令已提交'
      if (mode !== 'D-response-loss') await expect(result).toContainText(expected)
      if (mode === 'B-revoked-between') await expect(panel.getByRole('alert')).toContainText('作品授权已撤销')
      await expect(panel.getByRole('button', { name: '只查询命令结果（不重发）', exact: true })).toBeEnabled()
      readOnlyBefore = databaseEvidence()
      await panel.getByRole('button', { name: '只查询命令结果（不重发）', exact: true }).click()
      await expect(result).toContainText(expected)
      await expect(panel.getByRole('button', { name: '只查询命令结果（不重发）', exact: true })).toBeEnabled()
      readOnlyAfter = databaseEvidence()
      expect(readOnlyAfter).toEqual(readOnlyBefore)
      await expect(result).toContainText('实际展示和朗读未确认')
      expect(await panel.innerText()).not.toMatch(/已送达|已播放完成|已投递到大屏/)
      expect(network.filter(n => n.method === 'POST' && n.path.endsWith('/deliver'))).toHaveLength(1)
      expect(network.filter(n => n.path.startsWith('/classroom-commands/')).every(n => decodeURIComponent(n.path).includes(deliveryId))).toBe(true)
      }
    }
  }
  if (mode.startsWith('C-')) expect(network.filter(n => n.path.endsWith('/deliver'))).toHaveLength(0)
  await page.screenshot({ path: path.join(root, `${mode}.png`), fullPage: true })
  status = 'passed'
} catch (cause) {
  error = String(cause)
  await page.screenshot({ path: path.join(root, `${mode}-failure.png`), fullPage: true })
  throw cause
} finally {
  fs.writeFileSync(path.join(root, `${mode}-browser.json`), JSON.stringify({ status, error, mode, database: environment.database, deliveryId, unknownObserved, readOnlyBefore, readOnlyAfter, revokedAttempt, network, consoleLog, blocked, actualDevicePlayback: 'unknown' }, null, 2))
  evidenceDb.close()
  await browser.close()
}
