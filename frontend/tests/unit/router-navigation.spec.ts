import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'
import { navigateBack } from '@/router/navigation'

const administrator = {
  account: 'admin',
  name: '管理员',
  role: 'admin',
  userType: 'administrator' as const,
}
const teacher = {
  account: 'teacher',
  name: '教师',
  role: 'teacher',
  userType: 'teacher' as const,
}

describe('统一路由元数据', () => {
  it('为全部路由提供名称、布局、标题、导航键和面包屑', () => {
    const names = new Set<string>()
    for (const route of routes) {
      expect(typeof route.name).toBe('string')
      expect(names.has(String(route.name))).toBe(false)
      names.add(String(route.name))
      expect(route.meta?.layout).toBeTruthy()
      expect(route.meta?.title).toBeTruthy()
      expect(route.meta).toHaveProperty('activeNav')
      expect(Array.isArray(route.meta?.breadcrumb)).toBe(true)
    }
  })

  it('保留旧管理路径并跳转到规范地址', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/classes')
    expect(router.currentRoute.value.fullPath).toBe('/admin/classes')
    await router.push('/students')
    expect(router.currentRoute.value.fullPath).toBe('/admin/students')
    await router.push('/devices')
    expect(router.currentRoute.value.fullPath).toBe('/admin/devices')
    await router.push('/classes/7/students')
    expect(router.currentRoute.value.fullPath).toBe('/admin/classes/7/students')
    await router.push('/classes/7/students/9')
    expect(router.currentRoute.value.fullPath).toBe('/admin/classes/7/students/9')
  }, 15_000)

  it('通过 URL 参数恢复班级、学生和资源详情', () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    expect(router.resolve('/admin/classes/7').name).toBe('class-detail')
    expect(router.resolve('/classes/7').name).toBe('legacy-class-detail')
    expect(router.resolve('/admin/classes/7/students').name).toBe('students')
    expect(router.resolve('/admin/classes/7/students/9').name).toBe('student-profile')
    expect(router.resolve('/admin/classrooms').name).toBe('classrooms')
    expect(router.resolve('/admin/classrooms/4').name).toBe('classroom-detail')
    expect(router.resolve('/admin/devices/5').name).toBe('device-detail')
    expect(router.resolve('/classes/7/students/9').name).toBe('legacy-class-student-profile')
    expect(router.resolve('/resources/12').name).toBe('resource-detail')
    expect(router.resolve('/resources/12/preview').name).toBe('resource-preview')
    expect(router.resolve('/missing/page').name).toBe('not-found')
  })
})

describe('统一返回规则', () => {
  it('优先返回显式业务来源', async () => {
    const resolver = createRouter({ history: createMemoryHistory(), routes })
    await resolver.push('/resources/2?from=/resources%3Fpage%3D2')
    const push = vi.fn().mockResolvedValue(undefined)
    const back = vi.fn()
    const router = { resolve: resolver.resolve.bind(resolver), push, back } as unknown as typeof resolver
    const route = resolver.currentRoute.value
    await navigateBack(router, route, { isLogin: true, teacherInfo: teacher })
    expect(push).toHaveBeenCalledWith('/resources?page=2')
    expect(back).not.toHaveBeenCalled()
  })

  it('拒绝无权限来源并使用安全默认页', async () => {
    const resolver = createRouter({ history: createMemoryHistory(), routes })
    await resolver.push('/classes/3?from=/admin/audit')
    const push = vi.fn().mockResolvedValue(undefined)
    const back = vi.fn()
    const router = { resolve: resolver.resolve.bind(resolver), push, back } as unknown as typeof resolver
    const route = resolver.currentRoute.value
    await navigateBack(router, route, { isLogin: true, teacherInfo: teacher })
    expect(push).toHaveBeenCalledWith({ name: 'my-classes' })
    expect(back).not.toHaveBeenCalled()
  })

  it('管理员直接访问班级详情时返回班级列表', async () => {
    const resolver = createRouter({ history: createMemoryHistory(), routes })
    await resolver.push('/classes/3')
    const push = vi.fn().mockResolvedValue(undefined)
    const router = { resolve: resolver.resolve.bind(resolver), push, back: vi.fn() } as unknown as typeof resolver
    const route = resolver.currentRoute.value
    await navigateBack(router, route, { isLogin: true, teacherInfo: administrator })
    expect(push).toHaveBeenCalledWith({ name: 'classes' })
  })
})
