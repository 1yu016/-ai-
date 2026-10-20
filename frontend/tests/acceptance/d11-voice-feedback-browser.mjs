/**
 * D-11 数字人课堂操作语音反馈闭环 · 隔离真实浏览器验收。
 *
 * 真实：Nest 控制器/服务、正式命令契约、SQLite 业务记录、课堂大屏页面、数字人 DOM 状态、教师端口令入口。
 * 替代：浏览器 SpeechSynthesis（大屏播报通道）为系统合成语音，不是付费 TTS；无物理音箱测量。
 */
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const { root, runId, deviceId } = JSON.parse(process.env.D11_META || '{}')
const env = JSON.parse(fs.readFileSync(path.join(root, 'environment.json'), 'utf8'))
if (!env.database.startsWith(root) || env.synchronize || env.migrationsRun) throw Error('Unsafe test environment')
const BASE = 'http://127.0.0.1:5189'
const ACCOUNT = 'i24b_synthetic'
const PASSWORD = 'Synthetic24b!'

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: path.join(root, 'd11-video') } })
await context.route('**/*', route =>
  new URL(route.request().url()).origin === BASE || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())

const teacherPage = await context.newPage()
const screenPage = await context.newPage()
const network = []
const consoleLog = []
const pageErrors = []
const scenarios = []
const speechObservations = []

const watch = (page, label) => {
  page.on('pageerror', error => { pageErrors.push(`${label}: ${error.message}`); consoleLog.push({ label, type: 'pageerror', message: error.message }) })
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleLog.push({ label, type: message.type(), message: message.text() }) })
  page.on('response', async res => {
    const url = new URL(res.url())
    if (url.pathname === '/classroom-commands' || url.pathname.endsWith('/rewards') || url.pathname.endsWith('/collective-rewards')) {
      network.push({ label, path: url.pathname, method: res.request().method(), request: res.request().postData(), status: res.status(), response: await res.text().catch(() => '[unavailable]') })
    }
  })
}
watch(teacherPage, 'teacher')
watch(screenPage, 'screen')

const caption = screenPage.locator('[data-test="screen-announcement-text"]')
const captionBox = screenPage.locator('[data-test="screen-announcement"]')
const speakingStage = screenPage.locator('.digital-human.speaking')
let status = 'failed'
let failure

async function command(text, expected) {
  await expect(teacherPage.getByRole('button', { name: '执行口令', exact: true })).toBeVisible()
  await teacherPage.getByRole('textbox', { name: '课堂口令文本输入' }).fill(text)
  await teacherPage.getByRole('button', { name: '执行口令', exact: true }).click()
  await expect(teacherPage.locator('.feedback.command')).toContainText(expected, { timeout: 25000 })
  return teacherPage.locator('.feedback.command').innerText()
}

/** 观察数字人是否真的进入说话态（不做硬性失败：无语音包的 headless 环境只能验证字幕与取消）。 */
async function observeSpeaking(label, timeout = 4000) {
  let speaking = false
  try { await expect(speakingStage).toHaveCount(1, { timeout }); speaking = true } catch { speaking = false }
  speechObservations.push({ label, digitalHumanSpeaking: speaking, at: new Date().toISOString() })
  return speaking
}

try {
  // ── 1. 教师端登录并打开现有课堂口令入口 ──
  await teacherPage.goto(`${BASE}/login?redirect=${encodeURIComponent(`/classroom/lesson/${runId}`)}`)
  await teacherPage.getByPlaceholder('请输入教师账号').fill(ACCOUNT)
  await teacherPage.getByPlaceholder('请输入密码').fill(PASSWORD)
  await teacherPage.getByRole('button', { name: '登录', exact: true }).click()
  await expect(teacherPage.locator('.voice-detail')).toBeVisible({ timeout: 25000 })
  await teacherPage.locator('.voice-detail').click()
  await expect(teacherPage.getByRole('textbox', { name: '课堂口令文本输入' })).toBeVisible()

  // ── 2. 打开真实学生大屏（同一浏览器、同一设备身份） ──
  await screenPage.goto(`${BASE}/classroom/screen/${deviceId}`)
  await expect(screenPage.getByText('正在课堂', { exact: true }).first()).toBeVisible({ timeout: 25000 })
  // 首次进入只登记基线：屏幕打开前已经发生的课堂操作不会被补播。
  await expect(captionBox).toHaveCount(0)
  scenarios.push({ name: '大屏首次进入不补播历史点名', status: 'passed' })

  // ── 3. 随机点名：数字人播报正式选中的学生 ──
  await command('点名合成学生', '正式点名已完成：合成学生')
  await expect(caption).toHaveText('合成学生，请你来回答吧。', { timeout: 15000 })
  await teacherPage.screenshot({ path: path.join(root, 'd11-specified-roll-call-teacher.png'), fullPage: true })
  await screenPage.screenshot({ path: path.join(root, 'd11-specified-roll-call-screen.png'), fullPage: true })
  const specifiedSpeaking = await observeSpeaking('specified_roll_call')
  scenarios.push({ name: '指定点名：数字人邀请正式学生回答', status: 'passed', caption: await caption.innerText(), specifiedSpeaking })

  await command('随机点名', '正式点名已完成')
  await expect(caption).toHaveText(/^请你来说一说，.+。$/, { timeout: 15000 })
  const randomCaption = await caption.innerText()
  const randomName = randomCaption.replace(/^请你来说一说，/, '').replace(/。$/, '')
  // 卡片可能比播报晚一个轮询节拍；播报名字必须与卡片中的正式选中学生一致。
  await expect.poll(async () => (await screenPage.locator('.roll-call-card strong').innerText()).trim(), { timeout: 10000 }).toBe(randomName)
  await screenPage.screenshot({ path: path.join(root, 'd11-random-roll-call-screen.png'), fullPage: true })
  scenarios.push({ name: '随机点名：播报教师端正式选中的学生', status: 'passed', caption: await caption.innerText(), student: randomName })

  // ── 4. 个人奖励：播报权威对象与数量 ──
  await command('给合成学生两朵小红花', '奖励已正式记录')
  await expect(caption).toHaveText('合成学生，你真棒！得到两朵小红花。', { timeout: 15000 })
  await screenPage.screenshot({ path: path.join(root, 'd11-student-reward-screen.png'), fullPage: true })
  scenarios.push({ name: '个人奖励：播报对象与花朵数量均来自正式记录', status: 'passed', caption: await caption.innerText() })

  // ── 5. 集体奖励：通过正式接口记录后由数字人集体鼓励 ──
  const login = await context.request.post(`${BASE}/auth/login`, { data: { account: ACCOUNT, password: PASSWORD } })
  expect(login.ok()).toBe(true)
  const auth = { Authorization: `Bearer ${(await login.json()).access_token}` }
  const runNow = await (await context.request.get(`${BASE}/classroom-runs/${runId}`, { headers: auth })).json()
  const collective = await context.request.post(`${BASE}/classroom-runs/${runId}/collective-rewards`, {
    headers: auth,
    data: { requestId: `d11-collective-${Date.now()}`, version: runNow.version, points: 3, rewardCategory: 'cooperation', reason: '一起合作' },
  })
  expect(collective.ok()).toBe(true)
  network.push({ label: 'acceptance', path: `/classroom-runs/${runId}/collective-rewards`, method: 'POST', status: collective.status(), response: await collective.text() })
  await expect(caption).toContainText('成长能量', { timeout: 15000 })
  await screenPage.screenshot({ path: path.join(root, 'd11-collective-reward-screen.png'), fullPage: true })
  scenarios.push({ name: '集体奖励：数字人集体鼓励（正式累计积分）', status: 'passed', caption: await caption.innerText() })

  // 集体奖励走独立 HTTP 客户端，教师页面持有的课堂版本已过期；重新载入页面刷新权威版本后再发口令。
  await teacherPage.reload()
  await expect(teacherPage.locator('.voice-detail')).toBeVisible({ timeout: 25000 })
  await teacherPage.locator('.voice-detail').click()
  await expect(teacherPage.getByRole('textbox', { name: '课堂口令文本输入' })).toBeVisible()

  // ── 6. 步骤过渡：简短过渡语，不影响原有资源流程 ──
  await command('下一步', '提交成功')
  await expect(caption).toHaveText('接下来，我们进入：第二教学环节。', { timeout: 15000 })
  scenarios.push({ name: '步骤切换：简短过渡语', status: 'passed', caption: await caption.innerText() })
  await command('上一步', '提交成功')
  // 回到已经播报过的步骤不重复过渡语；旧字幕随步骤身份变化立即清除。
  await expect(captionBox).toHaveCount(0, { timeout: 12000 })

  // ── 7. 重复投影 / 浏览器刷新不重放旧表扬 ──
  const beforeReload = await captionBox.count()
  await screenPage.reload()
  await expect(screenPage.getByText('正在课堂', { exact: true }).first()).toBeVisible({ timeout: 25000 })
  // 刷新后重新建立基线：同一条正式奖励不会再次播报。
  await screenPage.waitForTimeout(4000)
  await expect(captionBox).toHaveCount(0)
  scenarios.push({ name: '大屏刷新不重放历史表扬', status: 'passed', beforeReload })

  // ── 8. 资源播放与数字人播报不重叠 ──
  await command('播放当前资源', '提交成功')
  await screenPage.waitForFunction(() => {
    const audio = document.querySelector('audio')
    return Boolean(audio && !audio.paused && audio.currentTime > 0)
  }, null, { timeout: 25000 })
  const playingResource = 'playing'
  // 资源播放中发起点名：正式业务成功，但不抢话（本轮播报被丢弃，不会在资源结束后补播）。
  await command('随机点名', '正式点名已完成')
  await screenPage.waitForTimeout(4000)
  await expect(captionBox).toHaveCount(0)
  await screenPage.screenshot({ path: path.join(root, 'd11-media-priority.png'), fullPage: true })
  const audioState = await screenPage.evaluate(() => { const audio = document.querySelector('audio'); return audio ? { paused: audio.paused, currentTime: audio.currentTime, duration: audio.duration } : null })
  scenarios.push({ name: '资源音频播放中：不播报且不补播', status: 'passed', playingResource, audioState, caption: await captionBox.count() })
  await command('停止播放', '提交成功')
  // 正式 stop_media 必须真的停住大屏声音（元素仍在舞台，但已暂停），否则播报会被永久让位。
  await expect.poll(async () => (await screenPage.evaluate(() => {
    const audio = document.querySelector('audio')
    return audio ? { paused: audio.paused, currentTime: audio.currentTime } : null
  }))?.paused, { timeout: 15000 }).toBe(true)
  // 资源结束后新的点名正常播报（说明丢弃只影响重叠的那一轮）。
  await command('点名合成学生', '正式点名已完成：合成学生')
  await expect(caption).toHaveText('合成学生，请你来回答吧。', { timeout: 15000 })
  scenarios.push({ name: '资源停止后新的课堂操作恢复播报', status: 'passed', caption: await caption.innerText() })

  // ── 9. 播放中教师停止：暂停课堂立即取消播报且迟到回调不重新发声 ──
  expect(await captionBox.count()).toBe(1)
  await command('暂停课堂', '提交成功')
  await expect(captionBox).toHaveCount(0, { timeout: 10000 })
  await expect(speakingStage).toHaveCount(0)
  await screenPage.screenshot({ path: path.join(root, 'd11-paused-cancelled.png'), fullPage: true })
  scenarios.push({ name: '教师暂停：立即取消数字人播报', status: 'passed' })
  // 暂停中的正式点名被拒绝，且不产生新的播报。
  const rejected = await command('随机点名', '操作受当前课堂阶段')
  await screenPage.waitForTimeout(3000)
  await expect(captionBox).toHaveCount(0)
  scenarios.push({ name: '业务失败不假装成功', status: 'passed', teacherFeedback: rejected })
  await command('恢复课堂', '提交成功')

  // ── 10. 大屏网络失败后恢复：不补播旧结果，也不阻塞后续教学 ──
  // Per-page CDP disconnects BOTH the existing SSE and polling. Merely aborting
  // screen-state requests leaves SSE live and is not an offline-screen test.
  const screenNetwork = await context.newCDPSession(screenPage)
  await screenNetwork.send('Network.enable')
  await screenNetwork.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await expect(screenPage.locator('main.page-recovery')).toBeVisible({ timeout: 18000 })
  await command('点名合成学生', '正式点名已完成：合成学生')
  await screenPage.screenshot({ path: path.join(root, 'd11-offline.png'), fullPage: true })
  await screenNetwork.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  // 断线期间产生的名点在恢复后是一次新的、未过期的课堂操作，安全恢复播报一次（不重复、不堆积）。
  await expect(caption).toHaveText('合成学生，请你来回答吧。', { timeout: 20000 })
  await screenPage.waitForTimeout(3000)
  expect(await captionBox.count()).toBe(1)
  scenarios.push({ name: '大屏断线期间不堆积，恢复后只播报当前有效结果一次', status: 'passed', isolation: 'per-page CDP, SSE and polling both disconnected' })
  await screenPage.screenshot({ path: path.join(root, 'd11-recovered.png'), fullPage: true })

  // ── 11. 儿童共享麦克风不能越权发起奖励/点名 ──
  await teacherPage.getByRole('dialog', { name: '课堂语音与口令', exact: true }).getByRole('button', { name: 'Close this dialog' }).click()
  const dialogue = teacherPage.getByRole('region', { name: '数字人课堂对话', exact: true })
  await dialogue.getByRole('checkbox', { name: '开启普通问题自动回答' }).check()
  const childInput = dialogue.getByRole('textbox', { name: '手动课堂问题' })
  const writesBefore = network.filter(item => item.method === 'POST' && (item.path === '/classroom-commands' || item.path.endsWith('/rewards') || item.path.endsWith('/collective-rewards'))).length
  await childInput.fill('奖励合成学生两朵小红花')
  await dialogue.getByRole('button', { name: '向数字人提问', exact: true }).click()
  await expect(dialogue).toContainText('本次没有执行', { timeout: 20000 })
  const writesAfter = network.filter(item => item.method === 'POST' && (item.path === '/classroom-commands' || item.path.endsWith('/rewards') || item.path.endsWith('/collective-rewards'))).length
  expect(writesAfter).toBe(writesBefore)
  await teacherPage.screenshot({ path: path.join(root, 'd11-child-no-privilege.png'), fullPage: true })
  scenarios.push({ name: '儿童输入不能产生课堂写操作', status: 'passed', inputMode: 'typed, no real microphone', writes: { before: writesBefore, after: writesAfter } })

  // ── 12. 语音能力边界（诚实记录，不作为通过条件） ──
  const voice = await screenPage.evaluate(() => {
    const synth = window.speechSynthesis
    return { available: Boolean(synth), voices: synth ? synth.getVoices().length : 0, speaking: synth ? synth.speaking : null }
  })
  scenarios.push({ name: '大屏合成语音能力记录', status: 'recorded', voice })
  expect(pageErrors).toEqual([])
  status = 'passed'
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  await screenPage.screenshot({ path: path.join(root, 'd11-failed-screen.png'), fullPage: true }).catch(() => {})
  await teacherPage.screenshot({ path: path.join(root, 'd11-failed-teacher.png'), fullPage: true }).catch(() => {})
} finally {
  await context.close()
  await browser.close()
  fs.writeFileSync(path.join(root, 'd11-browser.json'), JSON.stringify({
    status, failure, scenarios, speechObservations, network, consoleLog, pageErrors,
    scope: 'real isolated backend, canonical SQLite facts, real classroom screens and command bus; ' +
      'screen voice channel = browser SpeechSynthesis (system synthetic voice, not paid TTS); no physical speaker measurement',
  }, null, 2))
}
if (status !== 'passed') throw Error(failure)
