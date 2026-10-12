import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { routes } from '@/router'
import {
  resolveAuthNavigation,
  safeInternalRedirect,
  workspaceHome,
} from '@/router/authNavigation'

const teacher = {
  account: 'teacher',
  name: '教师',
  role: 'teacher',
  userType: 'teacher' as const,
}
const administrator = {
  account: 'admin',
  name: '管理员',
  role: 'admin',
  userType: 'administrator' as const,
}

function resolve(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return router.resolve(path)
}

describe('登录生命周期路由决策', () => {
  it('未登录访问受保护页面时记录完整 redirect', () => {
    const decision = resolveAuthNavigation(resolve('/lesson-plans?status=draft'), {
      isLogin: false,
      isAdmin: false,
      teacherInfo: null,
    })
    expect(decision).toEqual({
      name: 'login',
      query: { redirect: '/lesson-plans?status=draft' },
    })
  })

  it('教师访问管理员路由时进入无权限页并保留来源', () => {
    const decision = resolveAuthNavigation(resolve('/admin/teachers'), {
      isLogin: true,
      isAdmin: false,
      teacherInfo: teacher,
    })
    expect(decision).toEqual({
      name: 'forbidden',
      query: { from: '/admin/teachers' },
    })
  })

  it('已登录用户回到各自工作台并拒绝外部 redirect', () => {
    expect(resolveAuthNavigation(resolve('/login'), {
      isLogin: true,
      isAdmin: true,
      teacherInfo: administrator,
    })).toEqual({ name: 'admin-dashboard' })
    expect(workspaceHome(teacher)).toEqual({ name: 'my-classes' })
    expect(safeInternalRedirect('//example.com', workspaceHome(teacher))).toEqual({ name: 'my-classes' })
  })
})
