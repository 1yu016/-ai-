import { Buffer } from 'node:buffer'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

async function authenticateAdmin(page: Page, request: APIRequestContext): Promise<{ Authorization: string }> {
  const login = await request.post('/auth/admin/login', {
    data: { account: 'e2e_admin', password: 'E2eAdmin123!' },
  })
  expect(login.ok()).toBeTruthy()
  const tokens = (await login.json()) as { access_token: string; refresh_token?: string }
  const headers = { Authorization: `Bearer ${tokens.access_token}` }
  const profile = await request.get('/auth/profile', { headers })
  expect(profile.ok()).toBeTruthy()
  const user = await profile.json()
  await page.addInitScript(
    ({ token, refreshToken, user }) => {
      localStorage.setItem('kindergarten-ai-access-token', token)
      localStorage.setItem('kindergarten-ai-refresh-token', refreshToken)
      localStorage.setItem('kindergarten-ai-teacher-info', JSON.stringify(user))
    },
    { token: tokens.access_token, refreshToken: tokens.refresh_token ?? '', user },
  )
  return headers
}

test.describe.serial('路由元数据、面包屑和返回规则', () => {
  test('班级详情到学生资料支持逐级返回、刷新与浏览器前进后退', async ({ page, request }) => {
    const headers = await authenticateAdmin(page, request)
    const unique = Date.now()
    const createClass = await request.post('/classes', {
      headers,
      data: { name: `E2E导航班${unique}`, grade: '中班', ageRange: '4-5岁', schoolYear: '2026' },
    })
    expect(createClass.ok()).toBeTruthy()
    const schoolClass = (await createClass.json()) as { id: number; name: string }
    const createStudent = await request.post('/students', {
      headers,
      data: { classId: schoolClass.id, studentNo: `NAV-${unique}`, name: `导航幼儿${unique}` },
    })
    expect(createStudent.ok()).toBeTruthy()
    const student = (await createStudent.json()) as { id: number; name: string }

    await page.goto('/classes')
    await expect(page).toHaveURL(/\/admin\/classes$/)
    const row = page.locator('tr').filter({ hasText: schoolClass.name })
    await row.getByRole('button', { name: '查看', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/classes/${schoolClass.id}`))
    await expect(page.locator('[data-test="breadcrumbs"]')).toContainText(schoolClass.name)
    await expect(page.locator('.workspace-nav-link.active')).toContainText('班级与学生')

    await page.getByRole('button', { name: '学生列表' }).click()
    await expect(page).toHaveURL(new RegExp(`/classes/${schoolClass.id}/students`))
    const studentRow = page.locator('tr').filter({ hasText: student.name })
    await studentRow.getByRole('button', { name: '查看资料' }).click()
    await expect(page).toHaveURL(new RegExp(`/classes/${schoolClass.id}/students/${student.id}`))
    await page.reload()
    await expect(page.getByRole('heading', { name: student.name })).toBeVisible()
    await expect(page.locator('[data-test="breadcrumbs"]')).toContainText(student.name)

    await page.locator('[data-test="back-button"]').click()
    await expect(page).toHaveURL(new RegExp(`/classes/${schoolClass.id}/students`))
    await page.locator('[data-test="workspace-back"]').click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/admin/classes/${schoolClass.id}`)
    await page.locator('[data-test="back-button"]').click()
    await expect(page).toHaveURL(/\/admin\/classes$/)

    await page.goForward()
    await expect(page).toHaveURL(new RegExp(`/admin/classes/${schoolClass.id}`))
    await page.goBack()
    await expect(page).toHaveURL(/\/admin\/classes$/)
  })

  test('资源列表、详情和预览逐级返回，旧地址和 404 保持可用', async ({ page, request }) => {
    const headers = await authenticateAdmin(page, request)
    const unique = Date.now()
    const title = `E2E导航资源${unique}`
    const upload = await request.post('/resources/upload', {
      headers,
      multipart: {
        title,
        category: '图片卡片',
        ageGroup: 'middle',
        aliases: '[]',
        tags: '["navigation"]',
        file: {
          name: `navigation-${unique}.png`,
          mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
        },
      },
    })
    expect(upload.ok()).toBeTruthy()
    const resource = (await upload.json()) as { id: number }

    await page.goto(`/resources?keyword=${encodeURIComponent(title)}`)
    const card = page.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: '详情' }).click()
    await expect(page).toHaveURL(new RegExp(`/resources/${resource.id}`))
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/resources/${resource.id}/preview`))
    await page.reload()
    await expect(page.locator('[data-test="breadcrumbs"]')).toContainText(title)

    await page.locator('[data-test="back-button"]').click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/resources/${resource.id}`)
    await page.locator('[data-test="back-button"]').click()
    await expect(page).toHaveURL(/\/resources\?keyword=/)

    await page.goto('/students')
    await expect(page).toHaveURL(/\/admin\/students$/)
    await page.goto('/devices')
    await expect(page).toHaveURL(/\/admin\/devices$/)
    await page.goto('/this-page-does-not-exist')
    await expect(page.getByRole('heading', { name: '这个页面不存在' })).toBeVisible()

    await request.delete(`/resources/${resource.id}`, { headers })
  })
})
