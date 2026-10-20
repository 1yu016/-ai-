import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const { root, runId } = JSON.parse(process.env.D10_META || '{}')
const env = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!env.database.startsWith(root) || env.synchronize || env.migrationsRun || env.modelConfigured) throw Error('Unsafe test environment')
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: path.join(root, 'd10-video') } })
await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5189' || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
const page = await context.newPage(), network = [], consoleLog = [], scenarios = []
const pageErrors = []
page.on('pageerror', error => { pageErrors.push(error.message); consoleLog.push({ type: 'pageerror', message: error.message }) })
page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleLog.push({ type: message.type(), message: message.text() }) })
page.on('response', async res => {
  if (/^\/classroom-commands|\/dialogue$/.test(new URL(res.url()).pathname)) {
    network.push({ path: new URL(res.url()).pathname, method: res.request().method(), request: res.request().postData(), status: res.status(), response: await res.text().catch(() => '[response unavailable]') })
  }
})
let status = 'failed', failure
try {
  await page.goto(`http://127.0.0.1:5189/login?redirect=${encodeURIComponent(`/classroom/lesson/${runId}`)}`)
  await page.getByPlaceholder('请输入教师账号').fill('i24b_synthetic')
  await page.getByPlaceholder('请输入密码').fill('Synthetic24b!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('.voice-detail')).toBeVisible({ timeout: 20000 })
  await page.locator('.voice-detail').click()
  const input = page.getByRole('textbox', { name: '课堂口令文本输入' })
  const feedback = page.locator('.feedback.command')
  const command = async (text, expected) => {
    // Poll actual server capability freshness via UI; no randomized race sleeps.
    await expect(page.getByRole('button', { name: '执行口令', exact: true })).toBeVisible()
    await input.fill(text)
    await page.getByRole('button', { name: '执行口令', exact: true }).click()
    await expect(feedback).toContainText(expected, { timeout: 20000 })
    scenarios.push({ text, actual: await feedback.innerText(), status: 'passed' })
  }
  await command('点名合成学生', '正式点名已完成：合成学生')
  await command('随机点名', '正式点名已完成')
  await command('播放当前资源', '提交成功')
  await command('给他一朵小红花', '补充')
  // A normal authoritative poll must not discard an unchanged-context clarification.
  await page.waitForResponse(res => new URL(res.url()).pathname === `/classroom-runs/${runId}` && res.request().method() === 'GET')
  await command('合成学生', '奖励已正式记录')
  await page.screenshot({ path: path.join(root, 'd10-reward.png'), fullPage: true })
  // Lose only the HTTP response, after the REAL backend has committed the request.
  let lost, originalAuth
  await page.route('**/classroom-commands', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    originalAuth = route.request().headers().authorization
    const response = await route.fetch()
    lost = { request: JSON.parse(route.request().postData()), status: response.status(), result: await response.json() }
    await route.abort('failed')
  }, { times: 1 })
  await command('给合成学生两朵小红花', '暂时未知')
  expect(lost.status).toBe(201)
  await page.getByRole('button', { name: '查询原指令结果' }).click()
  await expect(feedback).toContainText('奖励已正式记录')
  scenarios.push({ name: 'response loss recovered by GET only', status: 'passed', lost })
  await page.screenshot({ path: path.join(root, 'd10-recovered.png'), fullPage: true })
  // Repeat exactly the same authenticated envelope. Existing server receipt owns idempotency.
  if (originalAuth) {
    const replay = await context.request.post('http://127.0.0.1:5189/classroom-commands', { headers: { Authorization: originalAuth }, data: lost.request })
    expect(replay.ok()).toBe(true)
    expect((await replay.json()).result).toEqual(lost.result.result)
    scenarios.push({ name: 'exact HTTP replay', status: 'passed' })
  } else throw Error('Cannot verify authenticated replay')
  await command('暂停课堂', '提交成功')
  const postsBeforeDenied = network.filter(n => n.method === 'POST').length
  await command('随机点名', /限制|不允许/)
  expect(network.filter(n => n.method === 'POST')).toHaveLength(postsBeforeDenied)
  await command('恢复课堂', '提交成功')
  await command('下一步', '提交成功')
  await command('开始课间', '提交成功')
  await command('继续上课', '提交成功')
  await page.screenshot({ path: path.join(root, 'd10-step.png'), fullPage: true })
  await page.getByRole('dialog', { name: '课堂语音与口令', exact: true }).getByRole('button', { name: 'Close this dialog' }).click()
  const dialogue = page.getByRole('region', { name: '数字人课堂对话', exact: true })
  await dialogue.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
  const childInput = dialogue.getByRole('textbox', { name: '手动课堂问题' })
  const commandCount = network.filter(n => n.method === 'POST' && n.path === '/classroom-commands').length
  await childInput.fill('奖励合成学生')
  await dialogue.getByRole('button', { name: '向数字人提问', exact: true }).click()
  await expect(dialogue).toContainText('本次没有执行')
  expect(network.filter(n => n.method === 'POST' && n.path === '/classroom-commands')).toHaveLength(commandCount)
  scenarios.push({ name: 'public input teacher intent does not execute', status: 'passed', inputMode: 'typed, no real microphone' })
  await childInput.fill('为什么圆形可以滚动？')
  await dialogue.getByRole('button', { name: '向数字人提问', exact: true }).click()
  await expect(dialogue.locator('[data-test="dialogue-reply"]')).toContainText('圆形', { timeout: 10000 })
  expect(network.filter(n => n.method === 'POST' && n.path === '/classroom-commands')).toHaveLength(commandCount)
  scenarios.push({ name: 'ordinary child question: real read-only backend with synthetic AI/review', status: 'passed' })
  await page.screenshot({ path: path.join(root, 'd10-child-question.png'), fullPage: true })
  expect(pageErrors).toEqual([])
  status = 'passed'
} catch (e) { failure = e.message; await page.screenshot({ path: path.join(root, 'd10-failed.png'), fullPage: true }).catch(() => {}) }
finally {
  await context.close(); await browser.close()
  fs.writeFileSync(path.join(root, 'd10-browser.json'), JSON.stringify({ status, failure, scenarios, network, consoleLog,
    scope: 'real isolated backend and canonical SQLite facts; typed teacher commands; no paid voice or physical display verification' }, null, 2))
}
if (status !== 'passed') throw Error(failure)
