import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

async function authenticate(
  page: Page,
  request: APIRequestContext,
  userType: 'teacher' | 'administrator',
): Promise<void> {
  const endpoint = userType === 'administrator' ? '/auth/admin/login' : '/auth/login'
  const account = userType === 'administrator' ? 'e2e_admin' : 'e2e_teacher'
  const password = userType === 'administrator' ? 'E2eAdmin123!' : 'E2eTeacher123!'
  const response = await request.post(endpoint, { data: { account, password } })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as {
    access_token: string
    refresh_token?: string
  }
  const profileResponse = await request.get('/auth/profile', {
    headers: { Authorization: `Bearer ${body.access_token}` },
  })
  expect(profileResponse.ok()).toBeTruthy()
  const user = (await profileResponse.json()) as Record<string, unknown>
  await page.addInitScript(
    ({ token, refreshToken, user }) => {
      localStorage.setItem('kindergarten-ai-access-token', token)
      localStorage.setItem('kindergarten-ai-refresh-token', refreshToken)
      localStorage.setItem('kindergarten-ai-teacher-info', JSON.stringify(user))
    },
    { token: body.access_token, refreshToken: body.refresh_token ?? '', user },
  )
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate<{ clientWidth: number; scrollWidth: number }>(
    '({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth })',
  )
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
}

test.describe('后台工作台基础架构', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
  })

  test('教师工作台显示统一导航和身份区且无页面横向溢出', async ({ page, request }) => {
    await authenticate(page, request, 'teacher')
    await page.goto('/my-classes')
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect(page.locator('aside[aria-label="工作台导航"]')).toContainText('我的班级')
    await expect(page.locator('[data-test="topbar-user"]')).toContainText('教师')
    await expectNoPageOverflow(page)
  })

  test('管理员工作台显示管理员导航和身份区且无页面横向溢出', async ({ page, request }) => {
    await authenticate(page, request, 'administrator')
    await page.goto('/admin')
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect(page.locator('aside[aria-label="工作台导航"]')).toContainText('数据看板')
    await expect(page.locator('[data-test="topbar-user"]')).toContainText('管理员')
    await expectNoPageOverflow(page)
  })

  test('课堂准备页继续使用独立布局', async ({ page, request }) => {
    await authenticate(page, request, 'teacher')
    await page.goto('/classroom/preflight/1')
    await expect(page.locator('.workspace-layout')).toHaveCount(0)
  })
})
