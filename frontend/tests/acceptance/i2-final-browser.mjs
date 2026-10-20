// Real HTTP through an explicitly isolated proxy. No fulfilled/synthetic API responses.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const meta = JSON.parse(process.env.I2_FINAL_META || '{}')
const environment = JSON.parse(fs.readFileSync(path.join(meta.root, 'environment.json'), 'utf8'))
if (!environment.database.startsWith(meta.root) || environment.synchronize || environment.migrationsRun || environment.backendPort !== 3189) throw Error('Isolation not verified')
const base = 'http://127.0.0.1:5189'
const browser = await chromium.launch({ headless: true })
const SQLite = createRequire(path.resolve('../backend/package.json'))('better-sqlite3')
const evidenceDb = new SQLite(environment.database, { readonly: true, fileMustExist: true })
const facts = () => Object.fromEntries(['classroom_run', 'classroom_operation_record', 'classroom_event', 'classroom_snapshot'].map(table => {
  const rows = evidenceDb.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()
  return [table, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
}))
const results = [], network = [], consoleLog = []
let status = 'failed', failure = null, activePage
async function open(bias = 0, mobile = false, account = 'i24b_synthetic') {
  const context = await browser.newContext({ viewport: { width: 1300, height: 1000 } })
  await context.addInitScript(({ bias, session }) => {
    const OriginalDate = Date
    class PhoneDate extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [OriginalDate.now() + bias])) }
      static now() { return OriginalDate.now() + bias }
    }
    globalThis.Date = PhoneDate
    if (session) sessionStorage.setItem('kindergarten-classroom-control-session-v1', JSON.stringify(session))
  }, { bias, session: mobile ? meta.session : null })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === base || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  const page = await context.newPage(); activePage = page
  page.on('console', item => { if (item.type() === 'error') consoleLog.push({ text: item.text() }) })
  page.on('pageerror', item => consoleLog.push({ pageerror: item.message }))
  page.on('response', async response => {
    const request = response.request(), url = new URL(response.url())
    if (!/\/(classroom-mobile|classroom-runs|auth)\//.test(url.pathname) || url.pathname.endsWith('/events')) return
    let body
    try { body = url.pathname.startsWith('/auth/') ? '[tokens omitted]' : await response.json() } catch { body = '[not JSON]' }
    network.push({ path: url.pathname, method: request.method(), request: url.pathname.startsWith('/auth/') ? '[credentials omitted]' : request.postData(), status: response.status(), body })
  })
  const destination = mobile ? '/classroom/remote' : `/classroom/records/${meta.completedRunId}`
  await page.goto(`${base}/login?redirect=${destination}`)
  await page.getByPlaceholder('请输入教师账号').fill(account)
  await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === destination || url.pathname === '/forbidden')
  return { page, context }
}
try {
  for (const bias of [0, -30000, 30000, -180000, 180000]) {
    const { page, context } = await open(bias, true)
    await expect(page.getByText('实时在线', { exact: true })).toBeVisible()
    const button = page.getByRole('button', { name: /^(暂停课堂|继续课堂)$/ })
    await expect(button).toBeEnabled()
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/classroom-mobile/commands') && r.request().method() === 'POST')
    await button.click()
    const response = await responsePromise, body = await response.json()
    expect(response.status()).toBe(201)
    expect(body.deliveryStatus).toBe('confirmed')
    expect(body.result.status).toBe('success')
    const payload = JSON.parse(response.request().postData())
    expect(Math.abs(Date.parse(payload.issuedAt) - Date.now())).toBeLessThan(10000)
    const jwt = await page.evaluate(() => localStorage.getItem('kindergarten-ai-access-token'))
    const headers = { Authorization: `Bearer ${jwt}`, 'X-Classroom-Control-Session': meta.session.token }
    const beforeReplay = facts()
    const repeated = await page.request.post(`${base}/classroom-mobile/commands`, { headers, data: payload })
    expect(repeated.status()).toBe(201)
    expect(facts()).toEqual(beforeReplay)
    const expiredPayload = { ...payload, requestId: `${payload.requestId}-expired`, issuedAt: new Date(Date.now() - 60000).toISOString() }
    const expired = await page.request.post(`${base}/classroom-mobile/commands`, { headers, data: expiredPayload })
    expect(expired.status()).toBe(408)
    expect(facts()).toEqual(beforeReplay)
    await context.setOffline(true)
    await expect(page.getByText('网络离线', { exact: true })).toBeVisible()
    await context.setOffline(false)
    await expect(page.getByText('实时在线', { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(meta.root, `mobile-clock-${bias}.png`), fullPage: true })
    results.push({ scenario: 'mobile clock/replay/expiry/reconnect', bias, status: 'passed', command: payload, first: body, repeatStatus: repeated.status(), expiredStatus: expired.status(), beforeReplay, afterReplayAndExpiry: facts() })
    await context.close()
  }
  {
    const { page, context } = await open()
    const confirm = page.getByRole('button', { name: '确认成为正式总结', exact: true })
    await expect(confirm).toBeVisible()
    await page.locator('textarea').first().fill('合成教师观察了圆形并记录课堂事实。')
    const response = page.waitForResponse(r => r.url().endsWith('/summary/confirm'))
    await confirm.click()
    expect((await response).status()).toBe(201)
    await expect(page.getByRole('button', { name: '保存正式总结修改', exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(meta.root, 'summary-legal-edit.png'), fullPage: true })
    results.push({ scenario: 'completed owned summary edit', status: 'passed' })
    await page.goto(`${base}/classroom/records/${meta.runId}`)
    await expect(page.locator('textarea').first()).toBeDisabled()
    await expect(page.getByRole('button', { name: /确认成为正式总结|保存正式总结修改/ })).toHaveCount(0)
    await page.screenshot({ path: path.join(meta.root, 'summary-active-readonly.png'), fullPage: true })
    results.push({ scenario: 'active run readonly', status: 'passed' })
    await context.close()
  }
  {
    const { page, context } = await open(0, false, 'i24b_other')
    await expect.poll(() => network.findLast(item => item.method === 'GET' && item.path === `/classroom-runs/${meta.completedRunId}/summary`)?.status).toBe(403)
    await expect(page.getByRole('button', { name: /确认成为正式总结|保存正式总结修改/ })).toHaveCount(0)
    const jwt = await page.evaluate(() => localStorage.getItem('kindergarten-ai-access-token'))
    expect(jwt).toBeTruthy()
    const denied = await page.request.post(`${base}/classroom-runs/${meta.completedRunId}/summary/confirm`, {
      headers: { Authorization: `Bearer ${jwt}` }, data: { classroomSummary: '合成摘要', participation: '合成参与', interestPoints: [], commonQuestions: [], teachingStrategies: [] },
    })
    expect(denied.status()).toBe(403)
    await page.screenshot({ path: path.join(meta.root, 'summary-forbidden.png'), fullPage: true })
    results.push({ scenario: 'unauthorized summary edit', status: 'passed', httpStatus: denied.status() })
    await context.close()
  }
  status = 'passed'
} catch (error) {
  failure = error.stack || String(error)
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(meta.root, 'final-browser-failure.png'), fullPage: true }).catch(() => {})
} finally {
  fs.writeFileSync(path.join(meta.root, 'final-browser.json'), JSON.stringify({ status, failure, results, network, consoleLog, realBackend: true, hardwarePlayback: 'not verified' }, null, 2))
  evidenceDb.close()
  await browser.close()
}
if (status !== 'passed') throw Error(failure)
