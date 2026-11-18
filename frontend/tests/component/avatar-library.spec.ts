import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAvatarCharacter,
  setClassAvatar,
  resolveAvatar,
  getAvatarCharacter,
  listAvatarCharacters,
} from '@/api/avatar'
import { useUserStore } from '@/stores/user'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import AvatarLibraryView from '@/views/AvatarLibraryView.vue'

vi.mock('@/components/ManagementLayout.vue', () => ({
  default: { template: '<main><slot /></main>' },
}))
vi.mock('@/components/DigitalHumanStage.vue', () => ({
  default: { template: '<div data-test="avatar-stage">数字人预览</div>' },
}))
vi.mock('@/api/platform', () => ({
  platformApi: { classes: vi.fn().mockResolvedValue({ data: { items: [{ id: 4, name: '向日葵班' }] } }) },
}))
vi.mock('@/stores/lessonPlan', () => ({
  useLessonPlanStore: () => ({ items: [], fetchList: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock('@/stores/lessonRun', () => ({
  useLessonRunStore: () => ({ run: null, adoptRun: vi.fn() }),
}))
vi.mock('@/api/avatar', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/avatar')>()
  return {
    ...original,
    listAvatarCharacters: vi.fn(),
    getAvatarCharacter: vi.fn(),
    fetchAvatarAsset: vi.fn(),
    createAvatarCharacter: vi.fn(),
    setClassAvatar: vi.fn(),
    resolveAvatar: vi.fn(),
  }
})

const listItem = {
  id: 7,
  name: '小鹿老师',
  category: 'teacher_assistant',
  description: '温暖的课堂助手',
  status: 'approved',
  ownerType: 'teacher',
  ownerId: 1,
  schoolId: 'garden-1',
  currentVersionId: 12,
}

const detail = {
  ...listItem,
  versions: [{
    id: 12,
    characterId: 7,
    version: 1,
    engineVersion: 'avatar-engine-1',
    modelFormat: 'glb' as const,
    status: 'ready' as const,
    assets: [],
  }],
  voiceProfile: {
    provider: 'system', voiceId: 'gentle', language: 'zh-CN', speed: 1, volume: 1, pitch: 0, status: 'active' as const,
  },
  personality: {
    style: '温暖启发式', catchphrases: ['我们先观察'], greeting: '小朋友们好', encouragementStyle: '再试一次', goodbyeText: '下次见',
  },
}

async function mountPage(admin = false) {
  const pinia = createPinia()
  const user = useUserStore(pinia)
  user.setLogin('token', {
    userId: 1,
    teacherId: admin ? undefined : 1,
    administratorId: admin ? 1 : undefined,
    account: admin ? 'admin' : 'teacher',
    name: admin ? '管理员' : '教师',
    userType: admin ? 'administrator' : 'teacher',
    role: admin ? 'admin' : 'teacher',
  })
  const wrapper = mount(AvatarLibraryView, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

describe('数字人角色库页面', () => {
  it('removes stale binding controls immediately while the next identity loads', async () => {
    const wrapper = await mountPage(true)
    let finish!: (value: typeof detail) => void
    vi.mocked(getAvatarCharacter).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.find('.role-card').trigger('click')
    expect(wrapper.find('.bindings').exists()).toBe(false)
    finish({ ...detail, name: '新加载角色' }); await flushPromises()
    expect(useDigitalHumanStore().roleName).toBe('新加载角色')
    wrapper.unmount()
  })
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(listAvatarCharacters).mockResolvedValue({ items: [listItem], total: 1, page: 1, pageSize: 100 })
    vi.mocked(getAvatarCharacter).mockResolvedValue(detail)
    vi.mocked(createAvatarCharacter).mockResolvedValue({ ...detail, id: 20, name: '自定义小鹿', status: 'draft', versions: [] })
    vi.mocked(setClassAvatar).mockResolvedValue({ id: 1 })
    vi.mocked(resolveAvatar).mockResolvedValue({ sourceScope: 'class', character: { id: 7, name: '小鹿老师', category: 'teacher_assistant' }, version: { id: 12, version: 1, engineVersion: 'avatar-engine-1', modelFormat: 'glb' }, renderAsset: null, action: { requested: 'idle', effective: null, contentUrl: null }, voice: null, personality: null, fallbackLevel: null, reason: null })
  })

  it('教师只请求已发布角色，并显示分类、配置、绑定与统一动作白名单', async () => {
    const wrapper = await mountPage(false)

    expect(listAvatarCharacters).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }))
    expect(wrapper.text()).toContain('教师助手')
    expect(wrapper.text()).toContain('声音与性格')
    expect(wrapper.text()).toContain('班级默认角色')
    expect(wrapper.text()).toContain('教案角色')
    expect(wrapper.text()).toContain('临时用于当前课堂')
    expect(wrapper.findAll('.action-row button').map((button) => button.text())).toEqual([
      'idle', 'listen', 'think', 'talk', 'question', 'happy', 'encourage', 'wave', 'goodbye',
    ])
    expect(wrapper.text()).not.toContain('自定义形象：上传、发布与审核')
  })

  it('管理员能看到角色创建、模型版本、审核发布和停用入口', async () => {
    const wrapper = await mountPage(true)

    expect(listAvatarCharacters).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }))
    expect(wrapper.text()).toContain('新建角色草稿')
    expect(wrapper.text()).toContain('自定义形象：上传、发布与审核')
    expect(wrapper.text()).toContain('创建模型版本')
    expect(wrapper.text()).toContain('停用角色')
  })
})

describe('角色创建和班级分配修复', () => {
  const button = (w: Awaited<ReturnType<typeof mountPage>>, label: string) => w.findAll('button').find(item => item.text() === label)!
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks()
    vi.mocked(listAvatarCharacters).mockResolvedValue({ items: [listItem], total: 1, page: 1, pageSize: 100 })
    vi.mocked(getAvatarCharacter).mockResolvedValue(detail)
    vi.mocked(createAvatarCharacter).mockResolvedValue({ ...detail, id: 20, name: '自定义小鹿', status: 'draft', versions: [] })
    vi.mocked(setClassAvatar).mockResolvedValue({ id: 1 })
    vi.mocked(resolveAvatar).mockResolvedValue({ sourceScope: 'class', character: { id: 7, name: '小鹿老师', category: 'teacher_assistant' }, version: { id: 12, version: 1, engineVersion: 'avatar-engine-1', modelFormat: 'glb' }, renderAsset: null, action: { requested: 'idle', effective: null, contentUrl: null }, voice: null, personality: null, fallbackLevel: null, reason: null })
  })
  it('新建使用独立空表单，不复制当前角色或直接提交', async () => {
    const wrapper = await mountPage(true)
    await button(wrapper, '新建角色草稿').trigger('click')
    expect(createAvatarCharacter).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('[aria-label="新角色名称"]').element.value).toBe('')
    expect(button(wrapper, '创建草稿').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="新角色名称"]').setValue('自定义小鹿')
    await button(wrapper, '创建草稿').trigger('click'); await flushPromises()
    expect(createAvatarCharacter).toHaveBeenCalledWith({ name: '自定义小鹿', category: 'teacher_assistant', description: '' })
    wrapper.unmount()
  })
  it('管理员分配当前发布版本并重新读取后端有效角色', async () => {
    vi.mocked(getAvatarCharacter).mockResolvedValue({ ...detail, versions: [{ ...detail.versions[0]!, id: 13, version: 2 }, ...detail.versions] })
    const wrapper = await mountPage(true)
    expect(button(wrapper, '设为班级默认角色').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="分配形象的班级"]').setValue('4'); await flushPromises()
    expect(wrapper.text()).toContain('该班当前有效形象：小鹿老师')
    await button(wrapper, '设为班级默认角色').trigger('click'); await flushPromises()
    expect(setClassAvatar).toHaveBeenCalledWith(4, { characterId: 7, versionId: 12, reason: '管理员在角色库分配数字人' })
    expect(resolveAvatar).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('班级默认角色已设置')
    wrapper.unmount()
  })
  it('教师不能通过班级分配按钮调用写接口', async () => {
    const wrapper = await mountPage(false)
    await wrapper.get('[aria-label="分配形象的班级"]').setValue('4'); await flushPromises()
    expect(button(wrapper, '设为班级默认角色').attributes('disabled')).toBeDefined()
    await button(wrapper, '设为班级默认角色').trigger('click')
    expect(setClassAvatar).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('未审核角色不可绑定，保留发布和审核限制', async () => {
    vi.mocked(getAvatarCharacter).mockResolvedValue({ ...detail, status: 'draft' })
    const wrapper = await mountPage(true)
    await wrapper.get('[aria-label="分配形象的班级"]').setValue('4'); await flushPromises()
    expect(button(wrapper, '设为班级默认角色').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('该角色尚未发布或缺少可用版本')
    wrapper.unmount()
  })
})
