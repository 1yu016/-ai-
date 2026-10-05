import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import ClassRewardDrawer from '@/components/classroom/ClassRewardDrawer.vue'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

const records = [
  { id: 1, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9, teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1, reason: '积极回答', requestId: 'r1', createdAt: '2026-10-02T14:32:00.000Z' },
  { id: 2, studentId: 2, studentName: '梦梦', classId: 1, classroomRunId: 9, teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1, reason: '乐于分享', requestId: 'r2', createdAt: '2026-10-02T14:35:00.000Z' },
  { id: 3, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9, teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1, reason: '认真观察', requestId: 'r3', createdAt: '2026-10-02T14:37:00.000Z' },
]

describe('ClassRewardDrawer 本节课奖励 drawer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('drawer 显示多条独立 RewardRecord（幼儿/数量/原因/教师），不聚合为“朵朵：2”', async () => {
    const wrapper = mount(ClassRewardDrawer, {
      props: { modelValue: true, rewards: records, totalStars: 3, loading: false },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    const items = document.body.querySelectorAll('.reward-item')
    expect(items).toHaveLength(3)
    const text = document.body.textContent ?? ''
    expect(text).toContain('朵朵')
    expect(text).toContain('梦梦')
    expect(text).toContain('积极回答')
    expect(text).toContain('乐于分享')
    expect(text).toContain('认真观察')
    expect(text).toContain('王雪梅')
    expect(text).toContain('累计 3 朵小红花')
    // 两条“朵朵”是独立记录，绝不出现聚合写法
    expect(text).not.toContain('朵朵：2')
    expect(text).not.toContain('朵朵:2')
    wrapper.unmount()
  })
})

describe('LessonClassroomView 本节课奖励入口', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const run = {
    id: 9,
    lessonPlanId: 3,
    deviceId: 1,
    version: 1,
    status: 'running',
    currentStepIndex: 0,
    title: '春天课堂',
    steps: [{ stepIndex: 0, title: '看一看', type: 'question', content: '你发现了什么？', resourceId: null, durationSeconds: 60 }],
    elapsedSeconds: 3,
    startedAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  it('点击“本节课奖励”按钮 → 打开 drawer 展示独立记录', async () => {
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      if (url.startsWith('/classroom-runs/9/rewards')) {
        return { data: { items: records, total: 3, runTitle: '春天课堂' } } as never
      }
      return { data: run } as never
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: LessonClassroomView, meta: { requiresAuth: true } },
      ],
    })
    router.push('/classroom/lesson/9')
    await router.isReady()
    const wrapper = mount(LessonClassroomView, {
      global: { plugins: [router, ElementPlus, createPinia()], stubs: { ResourcePlayer: true } },
      attachTo: document.body,
    })
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('本节课奖励（3）'))

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('本节课奖励'))!
      .trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.reward-item')).toHaveLength(3)
    expect(document.body.textContent).toContain('积极回答')
    expect(document.body.textContent).toContain('认真观察')
    wrapper.unmount()
  })
})
