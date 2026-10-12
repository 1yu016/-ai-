import ElementPlus, { ElMessage } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import ClassesView from '@/views/ClassesView.vue'
import ClassDetailView from '@/views/ClassDetailView.vue'

const classItem = {
  id: 1,
  name: '阳光中班',
  grade: '中班',
  ageRange: '4-5岁',
  schoolYear: '2026-2027',
  status: 'active',
  teachers: [{ teacherId: 2, name: '王老师', role: 'lead' }],
  studentCount: 18,
}
const classPage = { data: { items: [classItem], total: 1, page: 1, pageSize: 10 } }
const managementStub = { template: '<div><slot /></div>' }

async function mountList(path = '/admin/classes') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/classes', name: 'classes', component: ClassesView },
      { path: '/admin/classes/:classId', name: 'class-detail', component: { template: '<div>班级详情</div>' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ClassesView, { global: { plugins: [router, ElementPlus], stubs: { ManagementLayout: managementStub } } })
  await flushPromises()
  return { wrapper, router }
}

describe('班级管理', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(platformApi, 'classes').mockResolvedValue(classPage as never)
  })

  it('展示后端返回的负责教师、幼儿数量和状态', async () => {
    const { wrapper } = await mountList()
    expect(wrapper.text()).toContain('阳光中班')
    expect(wrapper.text()).toContain('王老师')
    expect(wrapper.text()).toContain('18 人')
    expect(wrapper.text()).toContain('启用')
  })

  it('把关键词、状态和分页交给后端查询', async () => {
    const { wrapper } = await mountList('/admin/classes?page=2&keyword=阳光&status=disabled')
    expect(platformApi.classes).toHaveBeenCalledWith({ page: 2, pageSize: 10, keyword: '阳光', status: 'disabled' })
    await wrapper.find('.filters input').setValue('中班')
    await wrapper.find('.filters select').setValue('active')
    await wrapper.find('.filters .button').trigger('click')
    await flushPromises()
    expect(platformApi.classes).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, keyword: '中班', status: 'active' })
  })

  it('新增成功以后才提示成功并重新读取列表', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    const create = vi.spyOn(platformApi, 'createClass').mockResolvedValue({ data: classItem } as never)
    const { wrapper } = await mountList()
    await wrapper.findAll('button').find((button) => button.text() === '新增班级')!.trigger('click')
    const inputs = wrapper.findAll('.form-grid input')
    await inputs[0]!.setValue('彩虹大班')
    await inputs[1]!.setValue('大班')
    await inputs[2]!.setValue('5-6岁')
    await inputs[3]!.setValue('2026-2027')
    await wrapper.findAll('button').find((button) => button.text() === '确认保存')!.trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ name: '彩虹大班', grade: '大班', ageRange: '5-6岁', schoolYear: '2026-2027' })
    expect(success).toHaveBeenCalledWith('班级添加成功')
    expect(platformApi.classes).toHaveBeenCalledTimes(2)
  })

  it('保存失败时保留表单且不显示成功', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    vi.spyOn(platformApi, 'createClass').mockRejectedValue({ response: { status: 409, data: { message: '班级仍被课堂引用' } } })
    const { wrapper } = await mountList()
    await wrapper.findAll('button').find((button) => button.text() === '新增班级')!.trigger('click')
    await wrapper.findAll('.form-grid input')[0]!.setValue('不能保存的班级')
    await wrapper.findAll('button').find((button) => button.text() === '确认保存')!.trigger('click')
    await flushPromises()
    expect(success).not.toHaveBeenCalled()
    expect((wrapper.findAll('.form-grid input')[0]!.element as HTMLInputElement).value).toBe('不能保存的班级')
  })
})

describe('班级详情', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('提供学生、奖励、问题和真实课堂记录入口', async () => {
    vi.spyOn(platformApi, 'classDetail').mockResolvedValue({ data: classItem } as never)
    vi.spyOn(platformApi, 'classRuns').mockResolvedValue({ data: { items: [{ id: 9, title: '认识数字', status: 'completed', startedAt: '2026-10-10T01:00:00.000Z', endedAt: '2026-10-10T01:30:00.000Z', createdAt: '2026-10-10T00:59:00.000Z' }], total: 1, page: 1, pageSize: 10 } } as never)
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/admin/classes/:classId', name: 'class-detail', component: ClassDetailView },
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div />' } },
      { path: '/classes/:classId/rewards', name: 'class-rewards', component: { template: '<div />' } },
      { path: '/classes/:classId/questions', name: 'class-questions', component: { template: '<div />' } },
      { path: '/classroom/records/:runId', name: 'classroom-record', component: { template: '<div />' } },
    ] })
    await router.push('/admin/classes/1'); await router.isReady()
    const wrapper = mount(ClassDetailView, { global: { plugins: [router], stubs: { ManagementLayout: managementStub, BackButton: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('学生列表')
    expect(wrapper.text()).toContain('成长奖励')
    expect(wrapper.text()).toContain('儿童问题')
    expect(wrapper.text()).toContain('课堂记录')
    expect(wrapper.text()).toContain('认识数字')
    expect(wrapper.text()).toContain('王老师')
  })

  it('无权教师访问详情时显示无权限状态', async () => {
    vi.spyOn(platformApi, 'classDetail').mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { message: '无权访问该班级' } } })
    vi.spyOn(platformApi, 'classRuns').mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { message: '无权访问该班级' } } })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/classes/:classId', name: 'class-detail', component: ClassDetailView }] })
    await router.push('/admin/classes/2'); await router.isReady()
    const wrapper = mount(ClassDetailView, { global: { plugins: [router], stubs: { ManagementLayout: managementStub, BackButton: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('当前账号没有访问这个班级的权限')
  })
})
