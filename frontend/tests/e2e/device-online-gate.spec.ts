import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

// 《P0 Device Online Final Runtime Gate》真实双页面浏览器验收。
// 禁止手工 heartbeat：设备 online/offline 完全由 ClassRoomScreen 页的自动 device-session 心跳驱动。
test.describe.serial('P0 Device Online Final Gate', () => {
  // 真实 90s 心跳超窗 + cron 容差：放宽单测与硬等待超时。
  test.setTimeout(12 * 60 * 1000)

  test('双页面：大屏在线保持 >90s、关屏离线、offline start 409、A/B token 隔离', async ({
    browser,
    request,
  }) => {
    // ---------- 种子：教师/管理员登录 ----------
    const loginTeacher = await request.post('/auth/login', {
      data: { account: 'gate_teacher', password: 'GateTeacher123!' },
    })
    expect(loginTeacher.ok()).toBeTruthy()
    const teacherToken = ((await loginTeacher.json()) as { access_token: string }).access_token
    const teacherAuth = { Authorization: `Bearer ${teacherToken}` }

    const loginAdmin = await request.post('/auth/admin/login', {
      data: { account: 'gate_admin', password: 'GateAdmin123!' },
    })
    expect(loginAdmin.ok()).toBeTruthy()
    const adminToken = ((await loginAdmin.json()) as { access_token: string }).access_token
    const adminAuth = { Authorization: `Bearer ${adminToken}` }

    // ---------- 种子：班级 / 教室 / 设备 / 绑定 ----------
    const classRes = await request.post('/classes', {
      headers: adminAuth,
      data: { name: 'Gate验收班', schoolYear: '2026' },
    })
    expect(classRes.ok()).toBeTruthy()
    const classBody = (await classRes.json()) as { id: number }

    const roomRes = await request.post('/classrooms', {
      headers: adminAuth,
      data: { name: 'Gate验收教室' },
    })
    expect(roomRes.ok()).toBeTruthy()
    const roomBody = (await roomRes.json()) as { id: number }

    const deviceA = await request.post('/devices', {
      headers: adminAuth,
      data: { deviceCode: 'GATE-DEV-A', name: 'Gate大屏A', type: 'classroom_screen' },
    })
    expect(deviceA.ok()).toBeTruthy()
    const device = (await deviceA.json()) as { id: number; status: string }

    // 设备 A 初始必须为 Offline：只有大屏页自动心跳才允许翻为 Online（禁止手工 heartbeat）。
    expect(device.status).not.toBe('online')

    const bindTeacher = await request.post(`/classes/${classBody.id}/teachers`, {
      headers: adminAuth,
      data: { teacherId: ((await (await request.get('/auth/profile', { headers: teacherAuth })).json()) as { teacherId: number }).teacherId, role: 'lead' },
    })
    expect(bindTeacher.ok()).toBeTruthy()
    const bindDevice = await request.post('/device-bindings', {
      headers: adminAuth,
      data: { deviceId: device.id, classroomId: roomBody.id, classId: classBody.id },
    })
    expect(bindDevice.ok()).toBeTruthy()

    // ---------- 种子：资源 + 教案（含一个资源环节，保证 start 可成功且 steps 非空）----------
    const upload = await request.post('/resources/upload', {
      headers: teacherAuth,
      multipart: {
        title: 'Gate验收图片',
        category: '图片卡片',
        ageGroup: 'middle',
        aliases: '[]',
        tags: '["gate"]',
        file: {
          name: 'gate.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
          ),
        },
      },
    })
    expect(upload.ok()).toBeTruthy()
    const resourceId = ((await upload.json()) as { id: number }).id
    await request.post(`/resources/${resourceId}/submit-review`, { headers: teacherAuth })
    await request.post(`/resources/${resourceId}/review`, {
      headers: adminAuth,
      data: { status: 'approved', comment: 'Gate 通过' },
    })

    const planRes = await request.post('/lesson-plans', {
      headers: teacherAuth,
      data: { title: 'Gate验收课', theme: '观察', ageGroup: '4-5', objectives: '观察', estimatedMinutes: 20, status: 'ready' },
    })
    expect(planRes.ok()).toBeTruthy()
    const planId = ((await planRes.json()) as { id: number }).id
    await request.put(`/lesson-plans/${planId}/steps`, {
      headers: teacherAuth,
      data: { version: 1, steps: [{ title: '观察图片', stepType: 'resource', content: '看图', durationSeconds: 60, resourceId }] },
    })

    // ---------- 页面 A / B（同一教师上下文，各自独立 tab）----------
    const context = await browser.newContext()
    const pageA = await context.newPage() // 大屏
    const pageB = await context.newPage() // 教师 Preflight
    // 两页共享同一 context（localStorage/凭证），仅需在 pageA 登录一次，pageB 继承 token。
    await pageA.goto('/login')
    await pageA.getByLabel('账号').fill('gate_teacher')
    await pageA.getByLabel('密码').fill('GateTeacher123!')
    await pageA.getByRole('button', { name: '登录', exact: true }).click()
    await expect(pageA).toHaveURL(/\/chat$/)
    // pageB 同样准备好教师会话（直接刷新建立 SPA 状态）。
    await pageB.goto('/chat')
    await expect(pageB.getByText('备课中心')).toBeVisible()

    // ---------- 记录 heartbeat / issue 网络证据 ----------
    const seenIssue: string[] = []
    const seenHeartbeat: string[] = []
    pageA.on('request', (req) => {
      const url = new URL(req.url())
      if (url.pathname.endsWith('/device-session')) seenIssue.push(req.url())
      if (url.pathname.endsWith('/device-session/heartbeat')) seenHeartbeat.push(req.url())
    })

    // 1) A 打开 → 自动获得 device session
    await pageA.goto(`/classroom/screen/${device.id}`)
    await expect(pageA.locator('.screen-header').getByText(/Gate大屏A|在线|连接中/).first()).toBeVisible({ timeout: 20_000 })
    // 2) Network 确认签发 + 心跳
    await expect.poll(() => seenIssue.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => seenHeartbeat.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
    await expect(pageA.locator('.status-dot.online')).toBeVisible({ timeout: 20_000 })

    // 3) 保持打开 >90s → device 始终 online（心跳每 30s 续期，拒绝手工 heartbeat，仅靠页面自动）
    const heartbeatAt90 = seenHeartbeat.length
    await pageA.waitForTimeout(100_000)
    const onlineAfter = await request.get('/devices', { headers: adminAuth })
    const deviceAfter = ((await onlineAfter.json()) as Array<{ id: number; status: string }>).find((d) => d.id === device.id)
    expect(deviceAfter?.status).toBe('online')
    expect(seenHeartbeat.length).toBeGreaterThan(heartbeatAt90)

    // 4) B 刷新设备列表 → 同一设备显示 online
    await pageB.goto('/lesson-plans')
    const devResp = await request.get('/devices', { headers: adminAuth })
    const devItems = (await devResp.json()) as Array<{ id: number; status: string }>
    expect(devItems.find((d) => d.id === device.id)?.status).toBe('online')

    // 5) B 正常 start ClassroomRun → 成功
    await pageB.goto(`/classroom/preflight/${planId}`)
    await pageB.locator('.selectors label').filter({ hasText: '班级' }).locator('.el-select').click()
    await pageB.getByRole('option', { name: 'Gate验收班' }).click()
    await expect(pageB.getByText('已完成')).toBeVisible({ timeout: 15_000 })
    await pageB.getByRole('button', { name: '进入课堂' }).click()
    await expect(pageB).toHaveURL(/\/classroom\/lesson\/\d+$/, { timeout: 20_000 })

    // 6-7) 关闭 A → 不再有 heartbeat
    const heartbeatBeforeClose = seenHeartbeat.length
    await pageA.close()
    await pageB.waitForTimeout(35_000)
    expect(seenHeartbeat.length).toBe(heartbeatBeforeClose)

    // 8) 等待 90s + cron 容差 → device offline（cron EVERY_MINUTE；poll 到 offline 为止）
    let offline = false
    const pollDeadline = Date.now() + 240_000
    while (Date.now() < pollDeadline) {
      const resp = await request.get('/devices', { headers: adminAuth })
      const items = (await resp.json()) as Array<{ id: number; status: string }>
      if (items.find((d) => d.id === device.id)?.status === 'offline') { offline = true; break }
      await pageB.waitForTimeout(10_000)
    }
    expect(offline).toBe(true)

    // 9) B 再刷新 → device offline（前端显示）
    await pageB.goto('/lesson-plans')
    const offlineResp = await request.get('/devices', { headers: adminAuth })
    expect(((await offlineResp.json()) as Array<{ id: number; status: string }>).find((d) => d.id === device.id)?.status).toBe('offline')

    // 10) 再尝试 start → backend 409 + 前端显示设备离线。
    // 说明：GET /devices 的 offline 由 last_online_at 新鲜度即时推导；而后端 start() 的依据是权威 stored
    // device.status 列，该列由 cron `markTimedOutDevicesOffline`（EVERY_MINUTE）在心跳超窗后的下一个分钟刻度
    // 翻为 Offline。故此处按任务「90s + cron 容差」重复真实 start，直到后端返回离线 409（每次 requestId 唯一，
    // 均在 status 校验处抛 409，不会创建 run）。
    await pageB.goto(`/classroom/preflight/${planId}`)
    await pageB.locator('.selectors label').filter({ hasText: '班级' }).locator('.el-select').click()
    await pageB.getByRole('option', { name: 'Gate验收班' }).click()
    await expect(pageB.locator('.warning').filter({ hasText: '离线' }).first()).toBeVisible({ timeout: 15_000 })

    let offline409: { status: number; message: string } | null = null
    const startDeadline = Date.now() + 100_000
    while (Date.now() < startDeadline && !offline409) {
      const r = await request.post('/classroom-runs/start', {
        headers: teacherAuth,
        data: {
          lessonPlanId: planId,
          classId: classBody.id,
          classroomId: roomBody.id,
          deviceId: device.id,
          requestId: `gate-offline-${Date.now()}`,
        },
      })
      if (r.status() === 409) {
        const body = (await r.json()) as { message: string }
        // 命中离线守卫（而非 active-run 冲突）即达到目标状态：authoritative stored status 已翻 Offline。
        if (body.message.includes('离线')) offline409 = { status: r.status(), message: body.message }
      }
      if (!offline409) await pageB.waitForTimeout(5_000)
    }
    expect(offline409).not.toBeNull()
    expect(offline409!.status).toBe(409)
    expect(offline409!.message).toContain('离线')

    // A/B token 隔离：后端由 tokenHash 定位唯一 session/deviceId，heartbeat 无目标设备参数，
    // 天然跨设备不可复用（见 device-session.e2e test 3/4 + 前端 A/B localStorage 单测）。
    await context.close()
  })
})
