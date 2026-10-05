import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import ClassroomOperationsView from '@/views/ClassroomOperationsView.vue'

const classes = { data: { items: [{ id: 1, name: '大一班', grade: null, ageRange: null, schoolYear: '2026', status: 'active' }] } }
const students = {
  data: {
    items: [
      { id: 1, classId: 1, studentNo: 'S1', name: '明明', nickname: null, status: 'active', createdAt: '', updatedAt: '' },
      { id: 2, classId: 1, studentNo: 'S2', name: '红红', nickname: null, status: 'active', createdAt: '', updatedAt: '' },
    ],
  },
}
const run = { id: 9, version: 3, deviceId: 2, status: 'running', currentStepIndex: 0, steps: [{ title: '问候' }] }

async function mountOps() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classroom/engagement', name: 'classroom-engagement', component: ClassroomOperationsView, meta: { requiresAuth: true } },
      { path: '/chat', component: { template: '<div>聊天页</div>' } },
    ],
  })
  router.push('/classroom/engagement')
  await router.isReady()
  return mount(ClassroomOperationsView, { global: { plugins: [router, ElementPlus, createPinia()] } })
}

function mockGets(restore = { attendanceState: {}, rewardState: {} }) {
  return vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
    if (url === '/classes') return classes as never
    if (url.startsWith('/students')) return students as never
    if (url === '/classroom-runs/active') return { data: run } as never
    if (url === '/classroom-runs/9') return { data: run } as never
    if (url.startsWith('/classroom-runs/9/restore')) return { data: restore } as never
    throw new Error(`unexpected GET ${url}`)
  })
}

/** 模拟：点击第一行 🌟 → 选择第一个快速原因 → 点击 "+1 小红花" 确认。 */
async function awardFirstStudent(wrapper: ReturnType<typeof mount>) {
  const row = wrapper.findAll('.student-row')[0]!
  await row.findAll('button').find((b) => b.text() === '🌟')!.trigger('click')
  await flushPromises()
  const dialog = document.body.querySelector('.el-dialog')
  expect(dialog).toBeTruthy()
  const chip = dialog!.querySelectorAll('.reason-chips button')[0] as HTMLElement
  chip.click()
  await flushPromises()
  const confirm = Array.from(dialog!.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('+1 小红花'),
  )
  expect(confirm).toBeTruthy()
  ;(confirm as HTMLElement).click()
  await flushPromises()
}

describe('ClassroomOperationsView 考勤/奖励状态收口', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('保存 checkpoint：点击到课后写入后端 attendanceState（非嵌套）', async () => {
    mockGets()
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: run } as never)

    const wrapper = await mountOps()
    await flushPromises()

    const row = wrapper.findAll('.student-row')[0]!
    const button = row.findAll('button').find((b) => b.text() === '到课')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/classroom-runs/9/checkpoints', expect.objectContaining({ checkpointType: 'roll_call' }))
    const body = post.mock.calls[0]![1] as Record<string, unknown>
    expect(body.attendanceState).toEqual({ 1: 'present' })
  })

  it('刷新重新加载：进入页面时调用 restore 读取后端快照', async () => {
    mockGets()

    await mountOps()
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/classroom-runs/9/restore', { params: { deviceId: 2 } })
  })

  it('页面恢复：restore 返回的状态渲染为已到人数与小红花总数', async () => {
    // 旧版嵌套形状，验证兼容性
    mockGets({ attendanceState: { attendance: { 1: 'present' } }, rewardState: { awards: { 1: 3 } } })
    vi.spyOn(http, 'post').mockResolvedValue({ data: run } as never)

    const wrapper = await mountOps()
    await flushPromises()

    expect(wrapper.text()).toContain('已到 1/2')
    expect(wrapper.text()).toContain('小红花 3')
  })

  it('点击奖励 → POST rewards → 成功后 UI +1（不再写 reward checkpoint）', async () => {
    mockGets()
    const post = vi.spyOn(http, 'post').mockImplementation(async (url: string) => {
      if (url === '/classroom-runs/9/rewards') {
        return {
          data: {
            record: { id: 11, studentId: 1, studentName: '明明', classId: 1, classroomRunId: 9, teacherId: 1, teacherName: '奖励教师', rewardType: 'flower', stars: 1, reason: '积极回答', requestId: 'reward-x', createdAt: '2026-10-02T14:32:00.000Z' },
            rewardState: { 1: 1 },
            studentTotal: 1,
          },
        } as never
      }
      throw new Error(`unexpected POST ${url}`)
    })

    const wrapper = await mountOps()
    await flushPromises()

    await awardFirstStudent(wrapper)

    // 走正式奖励写入口，携带 studentId/stars/reason
    expect(post).toHaveBeenCalledWith(
      '/classroom-runs/9/rewards',
      expect.objectContaining({ studentId: 1, stars: 1, reason: '积极回答' }),
    )
    // 不再直接写 reward checkpoint
    expect(post).not.toHaveBeenCalledWith(
      '/classroom-runs/9/checkpoints',
      expect.objectContaining({ checkpointType: 'reward' }),
    )
    expect(wrapper.text()).toContain('小红花 1')
  })

  it('POST rewards 失败 → UI 不增加（不乐观更新）', async () => {
    mockGets()
    const post = vi.spyOn(http, 'post').mockRejectedValue(new Error('network down'))

    const wrapper = await mountOps()
    await flushPromises()

    await awardFirstStudent(wrapper)

    expect(post).toHaveBeenCalledWith('/classroom-runs/9/rewards', expect.objectContaining({ studentId: 1 }))
    // 失败后小红花总数保持 0，不提前 +1
    expect(wrapper.text()).toContain('小红花 0')
  })
})
