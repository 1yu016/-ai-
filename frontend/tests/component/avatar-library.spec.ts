import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAvatarCharacter,
  listAvatarCharacters,
} from '@/api/avatar'
import { useUserStore } from '@/stores/user'
import AvatarLibraryView from '@/views/AvatarLibraryView.vue'

vi.mock('@/components/ManagementLayout.vue', () => ({
  default: { template: '<main><slot /></main>' },
}))
vi.mock('@/components/DigitalHumanStage.vue', () => ({
  default: { template: '<div data-test="avatar-stage">数字人预览</div>' },
}))
vi.mock('@/api/platform', () => ({
  platformApi: { classes: vi.fn().mockResolvedValue({ data: { items: [] } }) },
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
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(listAvatarCharacters).mockResolvedValue({ items: [listItem], total: 1, page: 1, pageSize: 100 })
    vi.mocked(getAvatarCharacter).mockResolvedValue(detail)
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
    expect(wrapper.text()).not.toContain('管理员发布与审核')
  })

  it('管理员能看到角色创建、模型版本、审核发布和停用入口', async () => {
    const wrapper = await mountPage(true)

    expect(listAvatarCharacters).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }))
    expect(wrapper.text()).toContain('新建角色草稿')
    expect(wrapper.text()).toContain('管理员发布与审核')
    expect(wrapper.text()).toContain('创建模型版本')
    expect(wrapper.text()).toContain('停用角色')
  })
})
