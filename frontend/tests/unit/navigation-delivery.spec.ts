import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '@/router'
import { resolveAuthNavigation, workspaceHome } from '@/router/authNavigation'

const teacher = { account: 'synthetic', name: '合成教师', role: 'teacher', userType: 'teacher' as const }
const admin = { account: 'synthetic_admin', name: '合成管理员', role: 'admin', userType: 'administrator' as const }
const session = (info: typeof teacher | typeof admin | null) => ({ isLogin: !!info, isAdmin: info?.userType === 'administrator', teacherInfo: info })
describe('确认后的导航交付契约', () => {
  it('保留50个原有命名路由及五个新增兼容入口', () => {
    const originalNames = 'home-redirect,chat,login,classes,admin-dashboard,admin-audit,teachers,my-classes,student-center,students,class-rewards,class-questions,class-artworks,student-profile,classrooms,classroom-detail,devices,device-detail,avatars,classroom-scan,classroom-join,classroom-screen,forbidden,lesson-plans,lesson-plan-new,lesson-plan-edit,lesson-classroom-preflight,lesson-classroom,classroom-record,lesson-classroom-summary,classroom-engagement,classroom-insights,classroom-remote,resources,resource-upload,resource-preview,resource-edit,resource-review,resource-detail,teacher-home,classroom-history,class-detail,legacy-class-detail,legacy-classes,legacy-students,legacy-class-students,legacy-class-student-profile,legacy-devices,legacy-student-profile,not-found'.split(',')
    expect(originalNames).toHaveLength(50)
    expect(routes.map(route => route.name)).toEqual(expect.arrayContaining(originalNames))
    expect(routes).toHaveLength(54)
  })
  it('教师默认工作台，管理员默认管理首页', () => {
    expect(workspaceHome(teacher)).toEqual({ name: 'teacher-home' })
    expect(workspaceHome(admin)).toEqual({ name: 'admin-dashboard' })
  })
  it.each(['/classroom/scan', '/classroom/join', '/classroom/remote'])('管理员不能进入教师手机授权流程 %s', path => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const target = router.resolve(path)
    expect(resolveAuthNavigation(target, session(admin))).toEqual({ name: 'forbidden', query: { from: path } })
    expect(resolveAuthNavigation(target, session(teacher))).toBe(true)
    expect(resolveAuthNavigation(target, session(null))).toEqual({ name: 'login', query: { redirect: path } })
  })
  it.each([
    ['/classrooms', '/admin/classrooms'], ['/classrooms/7', '/admin/classrooms/7'],
    ['/devices/8', '/admin/devices/8'], ['/teachers', '/admin/teachers'],
  ])('旧地址 %s 重定向但不跳过目标权限', async (oldPath, canonical) => {
    const router = createRouter({ history: createMemoryHistory(), routes: routes.map(route => route.component ? { ...route, component: { template: '<div />' } } : route) })
    await router.push(oldPath + '?from=%2Fteacher%2Fhome')
    expect(router.currentRoute.value.path).toBe(canonical)
    expect(router.currentRoute.value.query.from).toBe('/teacher/home')
    expect(resolveAuthNavigation(router.currentRoute.value, session(null))).toEqual({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    expect(resolveAuthNavigation(router.currentRoute.value, session(teacher))).toEqual(oldPath === '/teachers' ? { name: 'forbidden', query: { from: router.currentRoute.value.fullPath } } : true)
  })
})
