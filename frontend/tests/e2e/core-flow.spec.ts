import { expect, test } from '@playwright/test'

test.describe.serial('正式冻结核心流程', () => {
  test('教师从登录、备课到完成课堂并清理测试教案', async ({ page, request }) => {
    await expect((await request.get('/auth/profile')).status()).toBe(401)

    await page.goto('/login')
    await page.getByLabel('账号').fill('e2e_teacher')
    await page.getByLabel('密码').fill('E2eTeacher123!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)

    const token = await page.evaluate(() => localStorage.getItem('kindergarten-ai-access-token'))
    expect(token).toBeTruthy()
    const auth = { Authorization: `Bearer ${token}` }
    const schoolClassResponse = await request.post('/classes', {
      headers: auth,
      data: { name: 'E2E向日葵班', grade: '中班', ageRange: '4-5', schoolYear: '2026' },
    })
    const schoolClassBody = await schoolClassResponse.text()
    expect(schoolClassResponse.ok(), `创建E2E班级失败：http=${schoolClassResponse.status()} body=${schoolClassBody}`).toBeTruthy()
    const schoolClass = JSON.parse(schoolClassBody) as { id: number }
    const classroomResponse = await request.post('/classrooms', {
      headers: auth,
      data: { name: 'E2E教室', location: '测试楼层' },
    })
    expect(classroomResponse.ok()).toBeTruthy()
    const classroom = await classroomResponse.json() as { id: number }
    const deviceResponse = await request.post('/devices', {
      headers: auth,
      data: { deviceCode: 'E2E-SCREEN-001', name: 'E2E课堂大屏', type: 'classroom_screen' },
    })
    expect(deviceResponse.ok()).toBeTruthy()
    const device = await deviceResponse.json() as { id: number }
    expect((await request.patch(`/devices/${device.id}`, { headers: auth, data: { status: 'online' } })).ok()).toBeTruthy()
    expect((await request.post('/device-bindings', { headers: auth, data: { classId: schoolClass.id, classroomId: classroom.id, deviceId: device.id } })).ok()).toBeTruthy()
    const upload = await request.post('/resources/upload', {
      headers: auth,
      multipart: {
        title: 'E2E春天图片',
        category: '图片卡片',
        ageGroup: 'middle',
        aliases: '[]',
        tags: '["e2e"]',
        file: {
          name: 'e2e-spring.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
        },
      },
    })
    expect(upload.ok()).toBeTruthy()
    const uploadedResource = await upload.json() as { id: number }
    expect((await request.post(`/resources/${uploadedResource.id}/submit-review`, { headers: auth })).ok()).toBeTruthy()
    expect((await request.post(`/resources/${uploadedResource.id}/review`, {
      headers: auth,
      data: { status: 'approved', comment: 'E2E课堂资源审核通过' },
    })).ok()).toBeTruthy()

    await page.goto('/lesson-plans/new')
    await page.locator('.el-form-item').filter({ hasText: '教案标题' }).locator('input').fill('E2E冻结教案')
    await page.locator('.el-form-item').filter({ hasText: '主题' }).locator('input').fill('春天颜色')
    await page.locator('.el-form-item').filter({ hasText: '教学目标' }).locator('textarea').fill('观察并表达春天的颜色')

    const leaveWarning = page.waitForEvent('dialog')
    await page.evaluate(() => history.back())
    const dialog = await leaveWarning
    expect(['beforeunload', 'confirm']).toContain(dialog.type())
    if (dialog.type() === 'confirm') expect(dialog.message()).toContain('未保存')
    await dialog.dismiss()
    await expect(page).toHaveURL(/\/lesson-plans\/new$/)

    await page.getByRole('button', { name: '新增步骤' }).click()
    const firstStep = page.locator('.step').nth(0)
    await firstStep.locator('input[placeholder="环节标题"]').fill('观察图片')
    await firstStep.locator('textarea[placeholder*="教师指导语"]').fill('请看看图片里有哪些颜色。')
    await firstStep.locator('.el-select').click()
    await page.getByRole('option', { name: '资源' }).click()
    await firstStep.getByRole('button', { name: '选择资源' }).click()
    const resourceDialog = page.getByRole('dialog', { name: '选择课程资源' })
    await expect(resourceDialog).toContainText('E2E春天图片')
    await resourceDialog.locator('.resource-card').filter({ hasText: 'E2E春天图片' }).getByRole('button', { name: '选择' }).click()

    await page.getByRole('button', { name: '新增步骤' }).click()
    const secondStep = page.locator('.step').nth(1)
    await secondStep.locator('input[placeholder="环节标题"]').fill('说说发现')
    await secondStep.locator('textarea[placeholder*="教师指导语"]').fill('你发现了什么颜色？')
    await secondStep.locator('.el-select').click()
    await page.getByRole('option', { name: '提问' }).click()

    await page.getByRole('button', { name: '保存教案' }).click()
    await expect(page).toHaveURL(/\/lesson-plans\/\d+\/edit$/)
    const planId = Number(page.url().match(/lesson-plans\/(\d+)\/edit/)?.[1])
    expect(planId).toBeGreaterThan(0)

    await page.goto('/lesson-plans')
    const card = page.locator('.el-card').filter({ hasText: 'E2E冻结教案' })
    await card.getByRole('button', { name: '开始上课' }).click()
    await expect(page).toHaveURL(/\/classroom\/preflight\/\d+$/)
    await page.locator('.selectors label').filter({ hasText: '班级' }).locator('.el-select').click()
    await page.getByRole('option', { name: 'E2E向日葵班' }).click()
    await page.locator('.selectors label').filter({ hasText: '教室' }).locator('.el-select').click()
    await page.getByRole('option', { name: 'E2E教室' }).click()
    await page.locator('.selectors label').filter({ hasText: '大屏设备' }).locator('.el-select').click()
    await page.getByRole('option', { name: /E2E课堂大屏/ }).click()
    const startResponsePromise = page.waitForResponse((response) => response.url().includes('/classroom-runs/start') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '进入课堂' }).click()
    const startResponse = await startResponsePromise
    expect(startResponse.ok(), `启动E2E课堂失败：http=${startResponse.status()} body=${await startResponse.text()}`).toBeTruthy()
    await expect(page).toHaveURL(/\/classroom\/lesson\/\d+$/)
    await expect(page.getByRole('heading', { name: '观察图片' })).toBeVisible()

    await page.getByRole('button', { name: '下一步' }).click()
    await expect(page.getByRole('heading', { name: '说说发现' })).toBeVisible()
    await page.getByRole('button', { name: '暂停课堂' }).click()
    await expect(page.getByRole('button', { name: '继续课堂' })).toBeVisible()
    await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()
    await page.getByRole('button', { name: '继续课堂' }).click()

    await page.reload()
    await expect(page.getByRole('heading', { name: '说说发现' })).toBeVisible()
    await page.getByRole('button', { name: '结束课堂' }).click()
    await page.getByRole('button', { name: '确认' }).click()
    await expect(page).toHaveURL(/\/lesson-plans$/)

    const savedCard = page.locator('.el-card').filter({ hasText: 'E2E冻结教案' })
    await savedCard.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText('E2E冻结教案')).toHaveCount(0)
  })

  test('游客聊天入口仍可用（第三方模型响应使用路由 Mock）', async ({ page }) => {
    await page.route('**/ai/chat', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '你好呀，我们一起聊聊吧！' }) }))
    await page.goto('/chat')
    await expect(page.getByText('备课中心')).toHaveCount(0)
    await page.locator('textarea[aria-label="输入聊天消息"]').fill('你好')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByText('你好呀，我们一起聊聊吧！')).toBeVisible()
  })

  test.skip('管理员审核资源', async () => {
    // 当前工作区没有阶段9管理员审核接口和页面，作为正式冻结阻断项保留。
  })

  test.skip('普通教师访问管理员页面被拒绝', async () => {
    // 当前工作区没有管理员路由，无法进行真实越权页面测试。
  })
})
