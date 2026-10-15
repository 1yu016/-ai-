import { expect, test, type Page } from '@playwright/test'

async function loginAs(
  page: Page,
  type: 'teacher' | 'administrator',
): Promise<void> {
  await page.goto('/login')
  if (type === 'administrator') {
    await page.getByRole('button', { name: '管理员登录' }).click()
  }
  await page.getByLabel('账号').fill(type === 'administrator' ? 'e2e_admin' : 'e2e_teacher')
  await page.getByLabel('密码').fill(type === 'administrator' ? 'E2eAdmin123!' : 'E2eTeacher123!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
}

test.describe('登录生命周期与角色隔离', () => {
  test('未登录访问后台并在登录后恢复完整 redirect', async ({ page }) => {
    await page.goto('/lesson-plans?status=draft')
    await expect(page).toHaveURL((url) => url.pathname === '/login' && url.searchParams.get('redirect') === '/lesson-plans?status=draft')

    await page.getByLabel('账号').fill('e2e_teacher')
    await page.getByLabel('密码').fill('E2eTeacher123!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL(/\/lesson-plans\?status=draft$/)
  })

  test('密码错误保留账号并显示明确错误', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('账号').fill('e2e_teacher')
    await page.getByLabel('密码').fill('wrong-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByLabel('账号')).toHaveValue('e2e_teacher')
    await expect(page.locator('.login-error')).toBeVisible()
  })

  test('无效 Token 在刷新后清理并回到登录页', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('kindergarten-ai-access-token', 'expired-token')
      localStorage.setItem('kindergarten-ai-refresh-token', 'invalid-refresh-token')
      localStorage.setItem('kindergarten-ai-teacher-info', JSON.stringify({
        teacherId: 999,
        account: 'expired',
        name: '过期账号',
        role: 'teacher',
        userType: 'teacher',
      }))
    })
    await page.goto('/my-classes?source=refresh')
    await expect(page).toHaveURL((url) =>
      url.pathname === '/login' &&
      url.searchParams.get('reason') === 'expired' &&
      url.searchParams.get('redirect') === '/my-classes?source=refresh',
    )
  })

  test('教师不能进入管理员路由且菜单不展示管理员功能', async ({ page }) => {
    await loginAs(page, 'teacher')
    await expect(page).toHaveURL(/\/my-classes$/)
    await expect(page.locator('aside[aria-label="工作台导航"]')).not.toContainText('教师管理')
    await page.goto('/admin/teachers')
    await expect(page).toHaveURL((url) => url.pathname === '/forbidden' && url.searchParams.get('from') === '/admin/teachers')
    await expect(page.getByRole('link', { name: '返回工作台' })).toBeVisible()
  })

  test('管理员进入真实看板，退出后浏览器后退仍受保护', async ({ page }) => {
    await loginAs(page, 'administrator')
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: '数据看板' })).toBeVisible()
    await expect(page.locator('.card').filter({ hasText: '教师' })).toBeVisible()
    await expect(page.locator('.card').filter({ has: page.locator('span', { hasText: /^设备$/ }) })).toBeVisible()
    await expect(page.locator('.card').filter({ hasText: '待审核资源' })).toBeVisible()

    await page.locator('[data-test="topbar-user"]').click()
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('kindergarten-ai-access-token'))).toBeNull()
    await page.goBack()
    await expect(page).not.toHaveURL(/\/admin(?:\?|$)/)
  })
})
