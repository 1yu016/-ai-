/**
 * Stage 6.5《Resource Search / Open / Play Command》浏览器端到端测试。
 *
 * 目标链路（保持「AI 辅助、教师确认后儿童才看到」原则）：
 *   教师自然语言 → POST /ai/command → 搜索真实资源 → 展示候选 → 教师确认
 *   → 统一 resourcePlayer.openResource() → 受保护 blob 加载 → 播放/打开
 *
 * 测试前置（beforeAll，全部走真实后端 API）：
 *   教师登录 → 上传 3 个真实资源（2 个真实 mp4 + 1 个 png）→ 提交审核
 *   → 管理员登录 → 审核通过（已发布资源）→ 管理员建 班级/教室/设备/绑定
 *   → 教师绑定班级 → 建教案 + 步骤 → /classroom-runs/start 启动课堂
 *
 * Network 证据：
 *   - 资源搜索只通过已有 POST /ai/command；
 *   - 媒体加载只通过现有 GET /resources/:id/download（protected download）；
 *   - 全程不得出现 /resources/search-by-ai 等新增后端 endpoint。
 *
 * 注：后端对「播放忍者视频」等祈使句走本地正则（不依赖真实 LLM key），
 *     否定/疑问句走 LLM（E2E 用占位 key，最终落 unsupported/failed），
 *     两种情形都断言「未执行/无播放器副作用」。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TEACHER_ACCOUNT = 'e2e_teacher'
const TEACHER_PASSWORD = 'E2eTeacher123!'
const TEACHER_NAME = '端到端测试老师'
const ADMIN_ACCOUNT = 'e2e_admin'
const ADMIN_PASSWORD = 'E2eAdmin123!'

const TINY_MP4 = resolve(
  import.meta.dirname,
  '..',
  'fixtures',
  'media',
  'tiny.mp4',
)
/** 1×1 透明 PNG（真实可解码）。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** tsconfig.node.json 不引入 DOM lib，用结构化类型替代 HTMLVideoElement。 */
type VideoEl = { readyState: number; currentTime: number; paused: boolean }

type Auth = { token: string; teacherId: number }

let auth: Auth
let adminToken: string
let runId: number
let ninjaVideoId: number
let numVideoId: number
let numCardId: number

function trackDownloads(page: Page): string[] {
  const downloads: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (/^\/resources\/\d+\/download$/.test(pathname)) downloads.push(pathname)
  })
  return downloads
}

type TeacherInfo = { account: string; name: string; role: string; userType: string; teacherId: number }

async function openClassroomPage(page: Page, targetRunId: number) {
  await page.addInitScript(
    ([accessToken, info]: [string, TeacherInfo]) => {
      localStorage.setItem('kindergarten-ai-access-token', accessToken)
      localStorage.setItem('kindergarten-ai-refresh-token', '')
      localStorage.setItem('kindergarten-ai-teacher-info', JSON.stringify(info))
    },
    [
      auth.token,
      { account: TEACHER_ACCOUNT, name: TEACHER_NAME, role: 'teacher', userType: 'teacher', teacherId: auth.teacherId },
    ] as [string, TeacherInfo],
  )
  await page.goto(`/classroom/lesson/${targetRunId}`)
  await expect(page.locator('.step-heading')).toContainText('热身环节', { timeout: 30_000 })
}

async function teacherRequest(
  request: APIRequestContext,
  path: string,
  options: Record<string, unknown> = {},
) {
  const response = await request.post(path, {
    ...options,
    headers: { Authorization: `Bearer ${auth.token}`, ...(options.headers as Record<string, string> | undefined) },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<unknown>
}

async function adminRequest(
  request: APIRequestContext,
  path: string,
  options: Record<string, unknown> = {},
) {
  const response = await request.post(path, {
    ...options,
    headers: { Authorization: `Bearer ${adminToken}`, ...(options.headers as Record<string, string> | undefined) },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<unknown>
}

async function uploadResource(
  request: APIRequestContext,
  meta: {
    title: string
    category: string
    ageGroup: string
    resourceType: string
    tags: string[]
    fileName: string
    mimeType: string
    buffer: Buffer
  },
) {
  const response = await request.post('/resources/upload', {
    headers: { Authorization: `Bearer ${auth.token}` },
    multipart: {
      title: meta.title,
      category: meta.category,
      ageGroup: meta.ageGroup,
      resourceType: meta.resourceType,
      aliases: '[]',
      tags: JSON.stringify(meta.tags),
      file: { name: meta.fileName, mimeType: meta.mimeType, buffer: meta.buffer },
    },
  })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { id: number }
  expect(body.id).toBeGreaterThan(0)
  return body.id
}

test.describe.serial('Stage 6.5 资源搜索/打开/播放命令（真实已发布资源）', () => {
  test.beforeAll(async ({ request }) => {
    // 教师登录
    const teacherLogin = await request.post('/auth/login', {
      data: { account: TEACHER_ACCOUNT, password: TEACHER_PASSWORD },
    })
    expect(teacherLogin.ok()).toBeTruthy()
    const teacherBody = (await teacherLogin.json()) as {
      access_token: string
      teacherId: number
    }
    auth = { token: teacherBody.access_token, teacherId: teacherBody.teacherId }

    // 管理员登录
    const adminLogin = await request.post('/auth/admin/login', {
      data: { account: ADMIN_ACCOUNT, password: ADMIN_PASSWORD },
    })
    expect(adminLogin.ok()).toBeTruthy()
    const adminBody = (await adminLogin.json()) as { access_token: string }
    adminToken = adminBody.access_token

    // 上传 3 个资源（真实 mp4 读盘 + 1×1 png）
    ninjaVideoId = await uploadResource(request, {
      title: '忍者视频',
      category: '视频动画',
      ageGroup: 'middle',
      resourceType: 'video',
      tags: ['忍者', '动画'],
      fileName: 'ninja.mp4',
      mimeType: 'video/mp4',
      buffer: readFileSync(TINY_MP4),
    })
    numVideoId = await uploadResource(request, {
      title: '数字1的视频',
      category: '视频动画',
      ageGroup: 'small',
      resourceType: 'video',
      tags: ['数字'],
      fileName: 'number-one.mp4',
      mimeType: 'video/mp4',
      buffer: readFileSync(TINY_MP4),
    })
    numCardId = await uploadResource(request, {
      title: '数字1练习卡',
      category: '图片卡片',
      ageGroup: 'small',
      resourceType: 'image',
      tags: ['数字'],
      fileName: 'number-one-card.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    })

    // 教师提交审核 → 管理员审核通过（已发布资源）
    for (const id of [ninjaVideoId, numVideoId, numCardId]) {
      await teacherRequest(request, `/resources/${id}/submit-review`)
      await adminRequest(request, `/resources/${id}/review`, {
        data: { status: 'approved', comment: 'E2E 通过' },
      })
    }

    // 管理员：班级 / 教室 / 设备 / 绑定
    const classBody = (await adminRequest(request, '/classes', {
      data: { name: 'E2E资源命令班', schoolYear: '2026' },
    })) as { id: number }
    const classroomBody = (await adminRequest(request, '/classrooms', {
      data: { name: 'E2E资源命令教室' },
    })) as { id: number }
    const deviceBody = (await adminRequest(request, '/devices', {
      data: { deviceCode: 'E2E-DEV-RC01', name: 'E2E资源命令大屏', type: 'classroom_screen' },
    })) as { id: number }
    await adminRequest(request, `/classes/${classBody.id}/teachers`, {
      data: { teacherId: auth.teacherId, role: 'lead' },
    })
    await adminRequest(request, '/device-bindings', {
      data: { deviceId: deviceBody.id, classroomId: classroomBody.id, classId: classBody.id },
    })

    // 教师：建教案 + 步骤 → 启动课堂
    const planBody = (await teacherRequest(request, '/lesson-plans', {
      data: {
        title: 'E2E资源命令教案',
        theme: '数字与忍者',
        ageGroup: '4-5',
        objectives: '认识数字 1，欣赏忍者主题动画。',
        estimatedMinutes: 20,
      },
    })) as { id: number }
    await teacherRequest(request, `/lesson-plans/${planBody.id}/steps`, {
      data: {
        version: 1,
        title: '热身环节',
        stepType: 'introduction',
        content: '跟着老师一起热身。',
        durationSeconds: 60,
      },
    })
    const runBody = (await teacherRequest(request, '/classroom-runs/start', {
      data: {
        lessonPlanId: planBody.id,
        classId: classBody.id,
        classroomId: classroomBody.id,
        deviceId: deviceBody.id,
        requestId: 'e2e-resource-cmd-001',
      },
    })) as { id: number }
    runId = runBody.id
    expect(runId).toBeGreaterThan(0)
  })

  test('播放忍者视频：出现确认面板且未确认前不打开；确认后走受保护下载并真实播放', async ({ page }) => {
    const downloads = trackDownloads(page)
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('播放忍者视频')
    await page.getByRole('button', { name: '执行口令' }).click()

    const panel = page.getByLabel('资源候选确认')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('找到资源：忍者视频')
    await expect(page.locator('.feedback.command')).toContainText('正在查找')
    // 硬约束：教师确认前不得产生播放器副作用（无任何 download）
    expect(downloads.length).toBe(0)

    await panel.getByRole('button', { name: '播放', exact: true }).click()

    await expect.poll(() => downloads.length).toBeGreaterThan(0)
    await expect(page.locator('.feedback.command')).toContainText('已播放《忍者视频》。')

    // 受保护 blob 加载到 <video> 并真实播放
    const video = page.locator('.stage-video')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((el) => el.getAttribute('src') ?? ''), { timeout: 10_000 })
      .toContain('blob:')
    await expect
      .poll(() => video.evaluate((el) => (el as unknown as VideoEl).readyState), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1)
    await expect
      .poll(() => video.evaluate((el) => (el as unknown as VideoEl).currentTime), { timeout: 15_000 })
      .toBeGreaterThan(0)
  })

  test('播放数字1：出现多个真实候选；选择不可播放资源时降级为打开并明确告知', async ({ page }) => {
    const downloads = trackDownloads(page)
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('播放数字1')
    await page.getByRole('button', { name: '执行口令' }).click()

    const panel = page.getByLabel('资源候选确认')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('找到可能相关的资源，请确认是否使用。')
    expect(await panel.locator('.rcp-candidate').count()).toBe(2)
    await expect(panel).toContainText('数字1的视频')
    await expect(panel).toContainText('数字1练习卡')
    expect(downloads.length).toBe(0)

    // 选择图片候选：PLAY + image → 降级为打开，禁止 autoplay，并明确告知
    const card = panel.locator('.rcp-candidate').filter({ hasText: '数字1练习卡' })
    await card.getByRole('button', { name: '选择并打开' }).click()

    await expect.poll(() => downloads.length).toBeGreaterThan(0)
    await expect(page.locator('.feedback.command')).toContainText('已打开《数字1练习卡》')
    await expect(page.locator('.feedback.command')).toContainText('该资源不可播放，将以打开方式展示。')
    await expect(page.locator('.stage-video')).toHaveCount(0)
  })

  test('打开数字1的视频：确认后以打开方式展示，不自动播放', async ({ page }) => {
    const downloads = trackDownloads(page)
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('打开数字1的视频')
    await page.getByRole('button', { name: '执行口令' }).click()

    const panel = page.getByLabel('资源候选确认')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('找到资源：数字1的视频')
    expect(downloads.length).toBe(0)

    await panel.getByRole('button', { name: '打开', exact: true }).click()

    await expect.poll(() => downloads.length).toBeGreaterThan(0)
    await expect(page.locator('.feedback.command')).toContainText('已打开《数字1的视频》。')
    const video = page.locator('.stage-video')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((el) => (el as unknown as VideoEl).paused), { timeout: 10_000 })
      .toBe(true)
  })

  test('播放不存在的资源：not_found 固定反馈，无播放器副作用', async ({ page }) => {
    const downloads = trackDownloads(page)
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('播放不存在的视频')
    await page.getByRole('button', { name: '执行口令' }).click()

    await expect(page.locator('.feedback.command')).toContainText('没有找到合适的资源，未执行。')
    await expect(page.getByLabel('资源候选确认')).toHaveCount(0)
    expect(downloads.length).toBe(0)
  })

  test('取消候选：清空候选，无播放器副作用', async ({ page }) => {
    const downloads = trackDownloads(page)
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('播放忍者视频')
    await page.getByRole('button', { name: '执行口令' }).click()

    const panel = page.getByLabel('资源候选确认')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '取消' }).click()

    await expect(page.getByLabel('资源候选确认')).toHaveCount(0)
    await expect(page.locator('.feedback.command')).toContainText('已取消，未执行任何资源操作。')
    expect(downloads.length).toBe(0)
  })

  test('否定/疑问安全句：不搜索不播放，无播放器副作用', async ({ page }) => {
    const downloads = trackDownloads(page)
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('不要播放视频')
    await page.getByRole('button', { name: '执行口令' }).click()
    await expect(page.locator('.feedback.command')).toContainText('未执行')
    await expect(page.getByLabel('资源候选确认')).toHaveCount(0)

    await page.getByLabel('课堂口令文本输入').fill('数字1的视频为什么打不开？')
    await page.getByRole('button', { name: '执行口令' }).click()
    await expect(page.locator('.feedback.command')).toContainText('未执行')
    await expect(page.getByLabel('资源候选确认')).toHaveCount(0)

    expect(downloads.length).toBe(0)
  })

  test('Network：搜索走 /ai/command，媒体走受保护 download，无新增后端 endpoint', async ({ page }) => {
    const seen: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        seen.push(`${request.method()} ${url.pathname}`)
      }
    })
    await openClassroomPage(page, runId)

    await page.getByLabel('课堂口令文本输入').fill('播放忍者视频')
    await page.getByRole('button', { name: '执行口令' }).click()
    const panel = page.getByLabel('资源候选确认')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '播放', exact: true }).click()
    await expect
      .poll(() => seen.includes('POST /ai/command'))
      .toBe(true)
    await expect
      .poll(() => seen.some((entry) => /^GET \/resources\/\d+\/download$/.test(entry)))
      .toBe(true)

    // 不得出现任何新增的资源搜索 endpoint
    const banned = seen.filter((entry) =>
      /(search-by-ai|classroom-resource-search|ai\/resource-search|ai\/search)/.test(entry),
    )
    expect(banned).toEqual([])
  })
})
