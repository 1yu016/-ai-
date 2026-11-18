import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

test('integrated seed lesson: review gate, actual screen captions, media exit and question history', async ({ page, request }, info) => {
  test.setTimeout(120000)
  await page.goto('/login')
  await page.getByLabel('账号').fill('e2e_teacher')
  await page.getByLabel('密码').fill('E2eTeacher123!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/teacher\/home$/)
  const access = await page.evaluate(() => localStorage.getItem('kindergarten-ai-access-token'))
  const teacher = { Authorization: 'Bearer ' + access }
  const adminLogin = await request.post('/auth/admin/login', { data: { account: 'e2e_admin', password: 'E2eAdmin123!' } })
  expect(adminLogin.ok()).toBeTruthy()
  const admin = { Authorization: 'Bearer ' + (await adminLogin.json()).access_token }
  const post = async (url: string, data: Record<string, unknown>, headers = admin) => {
    const response = await request.post(url, { headers, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  // Synthetic prerequisites go through authorized APIs; no business history or Run is inserted directly.
  const group = await post('/classes', { name: 'P5种子合成班', schoolYear: '2026' })
  const room = await post('/classrooms', { name: 'P5种子合成教室' })
  const device = await post('/devices', { name: 'P5种子合成大屏', deviceCode: 'P5-SEED-SCREEN', type: 'classroom_screen' })
  const profile = await (await request.get('/auth/profile', { headers: teacher })).json()
  await post('/classes/' + group.id + '/teachers', { teacherId: profile.teacherId, role: 'lead' })
  await post('/device-bindings', { deviceId: device.id, classId: group.id, classroomId: room.id })
  const upload = await request.post('/resources/upload', { headers: teacher, multipart: {
    title: 'P5种子课程测试图片', category: '图片卡片', ageGroup: 'large', aliases: '[]', tags: '[]',
    file: { name: 'seed-test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') },
  } })
  expect(upload.ok(), await upload.text()).toBeTruthy()
  const resource = await upload.json()
  await post('/resources/' + resource.id + '/submit-review', {}, teacher)
  await post('/resources/' + resource.id + '/review', { status: 'approved', comment: 'Synthetic test only' })
  const plan = await post('/lesson-plans', { title: 'P5神奇的种子——种子是怎样发芽的？', theme: '种子发芽', ageGroup: '5-6', objectives: '观察水分、空气和适宜温度', estimatedMinutes: 25, status: 'ready' }, teacher)
  const saved = await request.put('/lesson-plans/' + plan.id + '/steps', { headers: teacher, data: {
    version: plan.version, steps: [{ title: '观察种子', stepType: 'resource', content: '观察种子，讨论发芽需要的条件。', durationSeconds: 300, resourceId: resource.id,
      actions: [{ actionType: 'child_qa', actionName: 'configure', content: JSON.stringify({ seconds: 300, policy: 'teacher_review', topic: '种子发芽' }) }] },
      { title: '小小科学家', stepType: 'teacher_talk', content: '观察和记录', durationSeconds: 300 }],
  } })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  await page.getByRole('main').getByRole('button', { name: '备课中心', exact: true }).click()
  const card = page.locator('.el-card').filter({ hasText: plan.title })
  await card.getByRole('button', { name: '准备上课', exact: true }).click()
  await page.locator('.selectors label').filter({ hasText: '班级' }).locator('.el-select').click()
  await page.getByRole('option', { name: group.name, exact: true }).click()
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: '打开学生大屏', exact: true }).click()
  const screen = await popup
  await expect(screen.locator('.status-dot.online')).toBeVisible()
  await page.getByRole('button', { name: '准备到大屏', exact: true }).click()
  await expect(screen.locator('[data-test="screen-ready"]')).toBeVisible()
  await page.getByRole('button', { name: '开始上课', exact: true }).click()
  await expect(page).toHaveURL(/classroom\/lesson\/\d+$/)
  await page.getByRole('button', { name: '跳过开场', exact: true }).click()
  const runId = Number(page.url().match(/lesson\/(\d+)/)?.[1])
  const panel = page.getByRole('region', { name: '教师控制儿童自由问答' })
  await expect(panel.getByRole('button', { name: '教师开启儿童问答' })).toBeEnabled()
  await panel.getByRole('button', { name: '教师开启儿童问答' }).click()
  await expect(panel.getByLabel('儿童问题', { exact: true })).toBeVisible()
  const cases = [
    ['芽需要水', '水'],
    ['种子要喝水吗', '水'],
    ['不给种子浇水会怎么样', '发芽'],
    ['种子为什么需要水', '水'],
  ]
  const results: Array<Record<string, unknown>> = []
  for (const [question, expected] of cases) {
    await panel.getByLabel('儿童问题', { exact: true }).fill(question!)
    await panel.getByRole('button', { name: '提交儿童问题', exact: true }).click()
    await expect(panel.locator('[data-test="child-qa-draft"]')).toContainText('本地种子知识卡')
    await expect(screen.locator('[data-test="approved-child-question"]')).toContainText(question!)
    await expect(screen.locator('[data-test="child-qa-status"]')).toContainText('老师正在确认答案')
    await expect(screen.locator('[data-test="approved-child-answer"]')).toHaveCount(0)
    await screen.screenshot({ path: info.outputPath('pending-' + results.length + '.png') })
    await panel.getByRole('button', { name: '教师确认并播报', exact: true }).click()
    await expect(screen.locator('[data-test="approved-child-answer"]')).toContainText(expected!)
    const answer = await screen.locator('[data-test="approved-child-answer"]').textContent()
    results.push({ question, answer, teacherApproved: true })
    await screen.screenshot({ path: info.outputPath('approved-' + results.length + '.png') })
    await panel.getByRole('button', { name: '回答已结束，请下一位', exact: true }).click()
  }
  await panel.getByLabel('儿童问题', { exact: true }).fill('天空为什么是蓝色')
  await panel.getByRole('button', { name: '提交儿童问题', exact: true }).click()
  await expect(panel.locator('[data-test="child-qa-draft"]')).toContainText('转交教师')
  await expect(screen.locator('[data-test="child-qa-status"]')).toContainText('请老师')
  await expect(screen.locator('[data-test="approved-child-answer"]')).toHaveCount(0)
  await panel.getByRole('button', { name: '结束儿童问答，恢复教师模式', exact: true }).click()
  await expect(panel.getByRole('button', { name: '教师开启儿童问答' })).toBeVisible()
  await expect(screen.locator('[data-test="approved-child-question"]')).toHaveCount(0)
  await expect(screen.locator('[data-test="approved-child-answer"]')).toHaveCount(0)
  // Simulate opening the exact ticket issued for the visible QR. This is NOT a physical phone scan.
  const ticketResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/classroom-tickets' && response.request().method() === 'POST')
  await page.getByRole('button', { name: '连接手机', exact: true }).click()
  const ticket = await (await ticketResponse).json()
  await expect(page.getByAltText('教师手机连接课堂的一次性二维码')).toBeVisible()
  await page.getByRole('button', { name: '关闭面板，继续上课', exact: true }).click()
  const mobileContext = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } })
  const mobile = await mobileContext.newPage()
  const join = new URL('/classroom/join', process.env.E2E_QR_ORIGIN || page.url())
  join.searchParams.set('ticket', ticket.ticket)
  join.searchParams.set('deviceCode', ticket.deviceCode)
  await mobile.goto(join.toString())
  await expect(mobile).toHaveURL(/login/)
  await mobile.getByLabel('账号').fill('e2e_teacher')
  await mobile.getByLabel('密码').fill('E2eTeacher123!')
  await mobile.getByRole('button', { name: '登录', exact: true }).click()
  await expect(mobile).toHaveURL(/classroom\/remote$/)
  await expect(mobile.getByText('实时在线', { exact: true })).toBeVisible()
  for (const [width,height] of [[360,800],[375,812],[390,844],[430,932]]) {
    await mobile.setViewportSize({width:width!,height:height!})
    await mobile.screenshot({path:info.outputPath('compact-'+width+'x'+height+'.png')})
    expect(await mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBeTruthy()
  }
  const beforePanels = await (await request.get('/classroom-runs/' + runId, { headers: teacher })).json()
  await mobile.getByRole('button',{name:'🎲 点名',exact:true}).click()
  await expect(mobile.getByRole('button',{name:'🎲 随机点名',exact:true})).toBeVisible()
  await mobile.getByRole('button',{name:'语音控制',exact:true}).click()
  await expect(mobile.getByText('手机端暂不支持教师语音识别。',{exact:false})).toBeVisible()
  const afterPanels = await (await request.get('/classroom-runs/' + runId, { headers: teacher })).json()
  expect(afterPanels.version).toBe(beforePanels.version)
  expect(afterPanels.playerRecoverySuggestion).toEqual(beforePanels.playerRecoverySuggestion)

  await page.getByRole('button', { name: '展示本环节课件', exact: true }).click()
  await expect(screen.locator('.resource-player')).toBeVisible()
  const mobileQa = mobile.getByRole('region', { name: '教师控制儿童自由问答' })
  await expect(mobile.locator('em')).toHaveText('媒体已暂停')
  await mobile.getByRole('button', {name:'问答',exact:true}).click()
  const startedOnMobile = mobile.waitForResponse(response => new URL(response.url()).pathname === '/classroom-mobile/commands' && response.request().postDataJSON()?.operation === 'child_qa_start')
  await mobileQa.getByRole('button', { name: '教师开启儿童问答', exact: true }).click()
  const startResponse = await startedOnMobile
  if (startResponse.status() === 409) {
    // A teacher action changed the version. Observe rejection and explicitly retry after the built-in refresh.
    await expect(mobileQa.getByRole('alert')).toContainText('版本')
    await mobileQa.getByRole('button', { name: '教师开启儿童问答', exact: true }).click()
  }
  await expect(mobileQa.getByLabel('儿童问题', { exact: true })).toBeVisible()
  for (const [width, height] of [[360,800],[375,812],[390,844],[430,932]]) {
    await mobile.setViewportSize({width:width!,height:height!})
    await mobile.screenshot({path: info.outputPath((process.env.MOBILE_UI_PHASE || 'after') + '-' + width + 'x' + height + '.png'),fullPage:true})
    expect(await mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBeTruthy()
  }
  await expect(screen.locator('.resource-player')).toHaveCount(0)
  await mobileQa.getByLabel('儿童问题', { exact: true }).fill('种子不浇水会怎样')
  await mobileQa.getByRole('button', { name: '提交儿童问题', exact: true }).click()
  await expect(screen.locator('[data-test="approved-child-question"]')).toContainText('种子不浇水会怎样')
  await expect(screen.locator('[data-test="approved-child-answer"]')).toHaveCount(0)
  await mobileQa.getByRole('button', { name: '教师确认并播报', exact: true }).click()
  await expect(screen.locator('[data-test="approved-child-answer"]')).toContainText('发芽')
  await mobile.screenshot({ path: info.outputPath('mobile-reviewed.png') })
  await screen.screenshot({ path: info.outputPath('mobile-answer-on-screen.png') })
  await mobileQa.getByRole('button', { name: '结束儿童问答，恢复教师模式', exact: true }).click()
  await expect(mobileQa.getByRole('button', { name: '教师开启儿童问答', exact: true })).toBeEnabled()
  await mobile.getByRole('button', {name:'更多工具',exact:true}).click()
  await mobile.getByRole('button', { name: '▶ 播放', exact: true }).click()
  await expect(screen.locator('.resource-player')).toBeVisible()
  await mobile.getByRole('button', { name: '停止媒体', exact: true }).click()
  await expect(screen.locator('.resource-player')).toHaveCount(0)
  await mobile.getByRole('button', { name: '停止媒体', exact: true }).click()
  await expect(screen.locator('.resource-player')).toHaveCount(0)
  await mobile.getByRole('button', { name: '退出手机控制', exact: true }).click()
  await mobileContext.close()
  const localClose = page.locator('.resource-player').getByRole('button', { name: /^(关闭播放器|返回课堂)$/ })
  if (await localClose.isVisible()) await localClose.click()
  await screen.reload()
  await expect(screen.locator('[data-test="screen-classroom-status"]')).toContainText('正在课堂')
  await expect(screen.locator('.resource-player')).toHaveCount(0)
  const state = await (await request.get('/classroom-runs/' + runId, { headers: teacher })).json()
  expect(state.status).toBe('running')
  expect(state.currentStepIndex).toBe(0)
  const records = await (await request.get('/classroom-runs/' + runId + '/questions', { headers: teacher })).json()
  const items = Array.isArray(records) ? records : records.items
  expect(items).toHaveLength(6)
  await info.attach('qa-results', { body: JSON.stringify({ runId, results, unrelated: 'teacher_handoff', records: items.length }), contentType: 'application/json' })
  await page.getByRole('button', { name: '刷新课堂状态', exact: true }).click()
  await expect(page.getByRole('button', { name: '结束课堂', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '结束课堂', exact: true }).click()
  await page.getByRole('button', { name: '确认结束', exact: true }).click()
  await expect(page).toHaveURL(/classroom\/lesson\/\d+\/summary$/)
  await page.getByRole('button', { name: '查看课堂记录与 AI 总结', exact: true }).click()
  await expect(page.getByText('课堂时间线', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我的班级', exact: true }).click()
  await page.locator('.class-card').filter({ hasText: group.name }).getByRole('button', { name: '进入班级', exact: true }).click()
  await page.getByRole('button', { name: /^儿童问题/ }).click()
  await expect(page.locator('.question-text')).toHaveCount(6)
  await expect(page.locator('.question-text').filter({ hasText: '种子不浇水会怎样' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('saved-class-questions.png'), fullPage: true })
})
