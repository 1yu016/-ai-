import { Buffer } from 'node:buffer'
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
          // 真实 PNG：含 8-byte 签名 89 50 4E 47 0D 0A 1A 0A（1×1 透明像素），
          // 通过后端 detectContentType 字节校验，否则上传返回 400「无法识别文件真实类型」。
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
          ),
        },
      },
    })
    expect(upload.ok()).toBeTruthy()
    const uploadBody = (await upload.json()) as { id: number }

    // 正式课堂要求资源已审核通过（draft 不能用于课堂），走 提交审核 → 管理员通过。
    const submitReview = await request.post(`/resources/${uploadBody.id}/submit-review`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(submitReview.ok()).toBeTruthy()
    const adminLogin = await request.post('/auth/admin/login', {
      data: { account: 'e2e_admin', password: 'E2eAdmin123!' },
    })
    expect(adminLogin.ok()).toBeTruthy()
    const adminBody = (await adminLogin.json()) as { access_token: string }
    const adminHeaders = { Authorization: `Bearer ${adminBody.access_token}` }
    const review = await request.post(`/resources/${uploadBody.id}/review`, {
      headers: adminHeaders,
      data: { status: 'approved', comment: 'E2E 通过' },
    })
    expect(review.ok()).toBeTruthy()
    const profile = await request.get('/auth/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(profile.ok()).toBeTruthy()
    const profileBody = (await profile.json()) as { teacherId: number }
    const classRes = await request.post('/classes', {
      headers: adminHeaders,
      data: { name: 'E2E冻结班', schoolYear: '2026' },
    })
    expect(classRes.ok()).toBeTruthy()
    const classBody = (await classRes.json()) as { id: number }
    const classroomRes = await request.post('/classrooms', {
      headers: adminHeaders,
      data: { name: 'E2E冻结教室' },
    })
    expect(classroomRes.ok()).toBeTruthy()
    const classroomBody = (await classroomRes.json()) as { id: number }
    const deviceRes = await request.post('/devices', {
      headers: adminHeaders,
      data: { deviceCode: 'E2E-DEV-CF01', name: 'E2E冻结大屏', type: 'classroom_screen' },
    })
    expect(deviceRes.ok()).toBeTruthy()
    const deviceBody = (await deviceRes.json()) as { id: number }
    const bindTeacher = await request.post(`/classes/${classBody.id}/teachers`, {
      headers: adminHeaders,
      data: { teacherId: profileBody.teacherId, role: 'lead' },
    })
    expect(bindTeacher.ok()).toBeTruthy()
    const bindDevice = await request.post('/device-bindings', {
      headers: adminHeaders,
      data: { deviceId: deviceBody.id, classroomId: classroomBody.id, classId: classBody.id },
    })
    expect(bindDevice.ok()).toBeTruthy()
    expect((await request.post(`/devices/${deviceBody.id}/heartbeat`, { headers: adminHeaders, data: { deviceCode: 'E2E-DEV-CF01' } })).ok()).toBeTruthy()

    await page.goto('/lesson-plans/new')
    await page.locator('.el-form-item').filter({ hasText: '教案标题' }).locator('input').fill('E2E冻结教案')
    await page.locator('.el-form-item').filter({ hasText: '主题' }).locator('input').fill('春天颜色')
    await page.locator('.el-form-item').filter({ hasText: '教学目标' }).locator('textarea').fill('观察并表达春天的颜色')

    const leaveWarning = page.waitForEvent('dialog')
    await page.evaluate(() => (globalThis as unknown as { history: { back(): void } }).history.back())
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
    // 新版「开始上课」先进入 preflight（选择班级/教室/设备），再启动课堂。
    await expect(page).toHaveURL(/\/classroom\/preflight\/\d+$/)
    await page.locator('.selectors label').filter({ hasText: '班级' }).locator('.el-select').click()
    await page.getByRole('option', { name: 'E2E冻结班' }).click()
    // 选择班级后自动填充已绑定教室/设备（classDeviceBindings）。
    await expect(page.getByText('已完成')).toBeVisible()
    await page.getByRole('button', { name: '进入课堂' }).click()
    await expect(page).toHaveURL(/\/classroom\/lesson\/\d+$/)
    await page.getByRole('button', { name: '跳过开场' }).click()
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
    await page.getByRole('button', { name: '确认结束', exact: true }).click()
    await expect(page).toHaveURL(/\/classroom\/lesson\/\d+\/summary$/)
    await page.getByRole('button', { name: '查看课堂记录与 AI 总结' }).click()
    await expect(page).toHaveURL(/\/classroom\/records\/\d+$/)
    await expect(page.getByRole('heading', { name: '星星探索课' }).or(page.getByRole('heading', { name: 'E2E冻结教案' }))).toBeVisible()
    await expect(page.getByText('课堂时间线', { exact: true })).toBeVisible()
    await expect(page.getByText(/总结草稿/)).toBeVisible()
    await page.getByRole('button', { name: '返回备课中心' }).click()
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

  test('管理员审核并停用异常资源', async ({ page, request }) => {
    const teacherLogin = await request.post('/auth/login', {
      data: { account: 'e2e_teacher', password: 'E2eTeacher123!' },
    })
    expect(teacherLogin.ok()).toBeTruthy()
    const teacherBody = (await teacherLogin.json()) as { access_token: string }
    const teacherHeaders = { Authorization: `Bearer ${teacherBody.access_token}` }

    const upload = await request.post('/resources/upload', {
      headers: teacherHeaders,
      multipart: {
        title: 'E2E管理员审核图片',
        category: '图片卡片',
        ageGroup: 'middle',
        aliases: '[]',
        tags: '["e2e-admin-review"]',
        file: {
          name: 'e2e-admin-review.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
          ),
        },
      },
    })
    expect(upload.ok()).toBeTruthy()
    const resource = (await upload.json()) as { id: number }
    const submitReview = await request.post(`/resources/${resource.id}/submit-review`, {
      headers: teacherHeaders,
    })
    expect(submitReview.ok()).toBeTruthy()

    await page.goto('/login')
    await page.getByRole('button', { name: '管理员登录' }).click()
    await page.getByLabel('账号').fill('e2e_admin')
    await page.getByLabel('密码').fill('E2eAdmin123!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)

    await page.goto(`/resources/${resource.id}/review`)
    await expect(page.getByRole('heading', { name: '资源审核' })).toBeVisible()
    await expect(page.locator('.info dd').filter({ hasText: 'E2E管理员审核图片' })).toBeVisible()
    await page.getByRole('button', { name: '通过', exact: true }).click()
    await expect(page.locator('.info dd').filter({ hasText: '已通过' })).toBeVisible()

    await page.getByRole('button', { name: '停用异常资源' }).click()
    await page.getByRole('button', { name: '确认停用' }).click()
    await expect(page.locator('.info dd').filter({ hasText: '已停用' })).toBeVisible()
  })

  test('普通教师访问管理员页面被拒绝', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('账号').fill('e2e_teacher')
    await page.getByLabel('密码').fill('E2eTeacher123!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)

    await page.goto('/admin')
    await expect(page).toHaveURL(/\/forbidden$/)
    await expect(page.getByRole('heading', { name: '暂无访问权限' })).toBeVisible()
  })
})
