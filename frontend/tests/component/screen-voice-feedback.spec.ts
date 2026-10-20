import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { useUserStore } from '@/stores/user'
import ClassroomScreenView from '@/views/ClassroomScreenView.vue'

// D-11：学生大屏「课堂操作语音反馈」集成行为。
// 用合成语音替换浏览器语音通道，记录真实发生的播报文本 / 取消次数，并驱动数字人说话状态。

type SpeechCall = { text: string; options: Record<string, (() => void) | undefined> }
const speech = vi.hoisted(() => ({ calls: [] as SpeechCall[], stops: 0, available: true }))
const realtime = vi.hoisted(() => ({ onState: null as ((state: unknown) => unknown) | null }))

vi.mock('@/services/browserSpeech', () => ({
  speakBrowserText: (text: string, options: Record<string, (() => void) | undefined> = {}) => {
    if (!speech.available) return false
    speech.calls.push({ text, options })
    return true
  },
  stopBrowserSpeech: () => { speech.stops += 1; return true },
  pauseBrowserSpeech: () => false,
  resumeBrowserSpeech: async () => false,
  playExclusiveAudio: async () => { throw new Error('测试中不应调用 playExclusiveAudio') },
}))

vi.mock('@/services/classroomRealtime', () => ({
  connectScreenRealtime: (options: { onState: (state: unknown) => unknown }) => {
    realtime.onState = options.onState
    return new AbortController()
  },
}))

const SCREEN_ID = 1

function classroomRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 9, lessonPlanId: 3, classId: 1, deviceId: SCREEN_ID, version: 2,
    status: 'running', currentStepIndex: 0, title: '认识数字1', objectives: '',
    steps: [
      { stepIndex: 0, title: '导入', type: 'introduction', content: '今天我们一起认识数字1', durationSeconds: 60, resourceId: null },
      { stepIndex: 1, title: '认识颜色', type: 'resource', content: '一起来看看颜色', durationSeconds: 60, resourceId: null },
    ],
    elapsedSeconds: 5, startedAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    rollCallState: {}, interactionState: {},
    ...overrides,
  }
}

let serverClock = Date.parse('2026-10-20T02:00:00.000Z')
const nextServerNow = () => {
  serverClock += 1000
  return new Date(serverClock).toISOString()
}
function screenState(overrides: Record<string, unknown> = {}) {
  const value = { page: 'classroom', deviceId: SCREEN_ID, classroomState: classroomRun(), serverNow: nextServerNow(), ...overrides }
  const call = value.classroomState.rollCallState as Record<string, unknown>
  if (call.lastRecordId && !Object.hasOwn(call, 'updatedAt')) call.updatedAt = value.serverNow
  return value as never
}

async function settle() {
  await flushPromises()
  await flushPromises()
}

async function mountScreen(initial: unknown) {
  let latest = initial
  vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
    if (String(url).startsWith('/classroom-runs/screen-state')) return { data: latest } as never
    if (String(url).endsWith('/reward-dashboard')) {
      const state = latest as { classroomState: { id: number; interactionState: { collectiveRewardState?: { recordIds: number[]; points: number } } }; serverNow: string }
      const collective = state.classroomState.interactionState.collectiveRewardState
      return { data: { collectiveRewards: (collective?.recordIds ?? []).map(id => ({ id, source: 'canonical', recordType: 'collective_reward', classroomRunId: state.classroomState.id, classId: 1, createdAt: state.serverNow, points: collective!.points, revokedAt: null })) } } as never
    }
    return { data: {} } as never
  })
  vi.spyOn(http, 'post').mockImplementation(async () => ({ data: {} }) as never)

  const pinia = createPinia()
  useUserStore(pinia).accessToken = 'test-token'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/classroom/screen/:deviceId?', name: 'classroom-screen', component: ClassroomScreenView, meta: { requiresAuth: true } }],
  })
  router.push(`/classroom/screen/${SCREEN_ID}`)
  await router.isReady()
  const wrapper = mount(ClassroomScreenView, {
    global: {
      plugins: [router, ElementPlus, pinia],
      stubs: { ResourcePlayer: true, DigitalHumanStage: true, ScreenOpeningPanel: true, ScreenSummaryPanel: true },
    },
    attachTo: document.body,
  })
  await settle()
  return {
    wrapper,
    digitalHuman: useDigitalHumanStore(pinia),
    player: useResourcePlayerStore(pinia),
    push: async (state: unknown) => { latest = state; realtime.onState?.(state); await settle() },
  }
}

const captionText = (wrapper: ReturnType<typeof mount>) => wrapper.find('[data-test="screen-announcement-text"]').text()

describe('ClassroomScreenView · D-11 课堂操作语音反馈', () => {
  beforeEach(() => {
    speech.calls = []
    speech.stops = 0
    speech.available = true
    sessionStorage.clear()
    serverClock = Date.parse('2026-10-20T02:00:00.000Z')
    document.body.innerHTML = ''
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('审查：sessionStorage 不可用时保留当前页面显示和内存去重', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('storage denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('storage denied') })
    const screen = await mountScreen(screenState())
    const state = () => screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 601, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) })
    await screen.push(state())
    await screen.push(state())
    expect(speech.calls).toHaveLength(1)
    screen.wrapper.unmount()
  })

  it('审查：资源加载阶段抢占等待中的语音，迟到 start 不复活，资源停止也不补播', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 501, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(1)
    const old = speech.calls[0]!
    screen.player.openResource({ id: '7', title: '合成视频', mediaType: 'video' } as never)
    await settle()
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)
    old.options.onStart?.()
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    screen.player.setStatus('ended')
    await settle()
    expect(speech.calls).toHaveLength(1)
    screen.wrapper.unmount()
  })

  it('审查：图片/音量/播放器观察更新不误停播报；外部语音接管正确复位数字人', async () => {
    const screen = await mountScreen(screenState())
    screen.player.openResource({ id: '7', title: '合成图片', mediaType: 'image' } as never)
    await settle()
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 502, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    const call = speech.calls.at(-1)!
    call.options.onStart?.()
    expect(screen.digitalHuman.isSpeaking).toBe(true)
    const stops = speech.stops
    screen.player.setVolume(0.4)
    screen.player.setProgress(2)
    await settle()
    expect(speech.stops).toBe(stops)
    call.options.onCancel?.()
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    call.options.onStart?.()
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    screen.wrapper.unmount()
  })

  it('#1 随机点名：进入课堂时只登记基线，新记录才播报正式选中的学生', async () => {
    // 进入课堂时投影里已有旧点名（例如大屏刚打开 / 老师在此之前已点名）：只建立基线，不补播旧结果。
    const screen = await mountScreen(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 21, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(0)
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)

    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 22, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls.map(c => c.text)).toEqual(['请你来说一说，朵朵。'])
    expect(captionText(screen.wrapper)).toBe('请你来说一说，朵朵。')
    expect(screen.wrapper.find('.roll-call-card strong').text()).toBe('朵朵')

    // 实际开始播放音频后才进入说话状态，播放结束恢复。
    speech.calls[0]!.options.onStart?.()
    expect(screen.digitalHuman.isSpeaking).toBe(true)
    speech.calls[0]!.options.onEnd?.()
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    screen.wrapper.unmount()
  })

  it('#2 指定点名与个人奖励：播报正确对象和权威数量', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 31, lastOperation: 'specified_roll_call', lastStudentDisplayName: '乐乐' } }) }))
    expect(captionText(screen.wrapper)).toBe('乐乐，请你来回答吧。')
    speech.calls.at(-1)!.options.onEnd?.()

    await screen.push(screenState({
      classroomState: classroomRun({
        rollCallState: { lastRecordId: 31, lastOperation: 'specified_roll_call', lastStudentDisplayName: '乐乐' },
        interactionState: {
          rewardPresentation: {
            recordId: 41, studentId: 2, displayName: '乐乐', rewardCategory: 'answer', rewardForms: ['flower'],
            points: 2, stars: 2, praiseText: null, createdAt: nextServerNow(),
          },
        },
      }),
    }))
    expect(captionText(screen.wrapper)).toBe('乐乐，你真棒！得到两朵小红花。')
    speech.calls.at(-1)!.options.onEnd?.()
    // 后端已提供表扬文本时复用同一条文本（不产生第二套表扬语音）。
    await screen.push(screenState({
      classroomState: classroomRun({
        interactionState: {
          rewardPresentation: {
            recordId: 42, studentId: 2, displayName: '乐乐', rewardCategory: 'answer', rewardForms: ['voice_praise'],
            points: 1, stars: 1, praiseText: '你认真思考的样子真棒！', createdAt: nextServerNow(),
          },
        },
      }),
    }))
    expect(speech.calls.map(c => c.text)).toEqual([
      '乐乐，请你来回答吧。', '乐乐，你真棒！得到两朵小红花。', '乐乐，你真棒！得到一朵小红花。',
    ])
    screen.wrapper.unmount()
  })

  it('#3 集体奖励播报集体鼓励（正式记录身份 + 全班累计积分）', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({
      classroomState: classroomRun({ interactionState: { collectiveRewardState: { recordIds: [51], points: 3 } } }),
    }))
    expect(captionText(screen.wrapper)).toBe('小朋友们一起努力，获得三点成长能量，真棒！')
    screen.wrapper.unmount()
  })

  it('#4 步骤过渡只播报简短过渡语', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ currentStepIndex: 1 }) }))
    expect(captionText(screen.wrapper)).toBe('接下来，我们进入：认识颜色。')
    screen.wrapper.unmount()
  })

  it('#5 同一轮多条正式结果按序播报，重复投影不重复入队', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({
      classroomState: classroomRun({
        rollCallState: { lastRecordId: 61, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' },
        interactionState: {
          rewardPresentation: {
            recordId: 62, studentId: 1, displayName: '朵朵', rewardCategory: 'answer', rewardForms: ['flower'],
            points: 1, stars: 1, praiseText: null, createdAt: nextServerNow(),
          },
        },
      }),
    }))
    expect(speech.calls.map(c => c.text)).toEqual(['朵朵，你真棒！得到一朵小红花。'])
    // 同轮点名身份已被消费：后续投影不再补播，避免与奖励播报抢话。
    await screen.push(screenState({
      classroomState: classroomRun({
        rollCallState: { lastRecordId: 61, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' },
        interactionState: {
          rewardPresentation: {
            recordId: 62, studentId: 1, displayName: '朵朵', rewardCategory: 'answer', rewardForms: ['flower'],
            points: 1, stars: 1, praiseText: null, createdAt: nextServerNow(),
          },
        },
      }),
    }))
    expect(speech.calls).toHaveLength(1)
    speech.calls[0]!.options.onEnd?.()
    expect(speech.calls.map(c => c.text)).toEqual(['朵朵，你真棒！得到一朵小红花。', '请你来说一说，朵朵。'])
    speech.calls[1]!.options.onEnd?.()
    expect(speech.calls).toHaveLength(2)
    screen.wrapper.unmount()
  })

  it('#6 重复投影 / 结果恢复不会重复播报', async () => {
    const screen = await mountScreen(screenState())
    const withRollCall = () => screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 71, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) })
    await screen.push(withRollCall())
    expect(speech.calls).toHaveLength(1)
    await screen.push(withRollCall())
    await screen.push(withRollCall())
    expect(speech.calls).toHaveLength(1)
    screen.wrapper.unmount()
  })

  it('#7 刷新 / 重新打开大屏后不重放旧表扬', async () => {
    const first = await mountScreen(screenState())
    const state = screenState({
      classroomState: classroomRun({
        interactionState: {
          rewardPresentation: {
            recordId: 81, studentId: 1, displayName: '朵朵', rewardCategory: 'answer', rewardForms: ['flower'],
            points: 1, stars: 1, praiseText: null, createdAt: nextServerNow(),
          },
        },
      }),
    })
    await first.push(state)
    expect(speech.calls).toHaveLength(1)
    first.wrapper.unmount()

    const second = await mountScreen(state)
    await settle()
    expect(speech.calls).toHaveLength(1)
    expect(second.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)
    second.wrapper.unmount()
  })

  it('#8 资源音频播放中不播报，且停止后不补播', async () => {
    const screen = await mountScreen(screenState())
    screen.player.openResource({ id: '7', mediaType: 'audio', title: '合成音频' } as never)
    screen.player.setStatus('playing')
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 91, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(0)
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)

    screen.player.setStatus('paused')
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 91, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(0)
    screen.wrapper.unmount()
  })

  it('#9 暂停课堂立即取消播报，迟到回调不重新发声', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 101, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(1)
    const late = speech.calls[0]!
    late.options.onStart?.()
    expect(screen.digitalHuman.isSpeaking).toBe(true)
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(true)
    const stopsBefore = speech.stops

    await screen.push(screenState({ classroomState: classroomRun({ status: 'paused', rollCallState: { lastRecordId: 101, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.stops).toBeGreaterThan(stopsBefore)
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)

    // 合成过程中被取消后，迟到的 ended 不能重新驱动说话，也不能重新播报。
    late.options.onEnd?.()
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    expect(speech.calls).toHaveLength(1)
    screen.wrapper.unmount()
  })

  it('#10 切换 Run 后旧课堂播报不进入新课堂', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 111, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(1)

    // 新课堂首轮只登记基线：即使记录 ID 相同也不播报。
    await screen.push(screenState({
      classroomState: classroomRun({ id: 10, rollCallState: { lastRecordId: 111, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }),
    }))
    expect(speech.calls).toHaveLength(1)

    await screen.push(screenState({
      classroomState: classroomRun({ id: 10, rollCallState: { lastRecordId: 112, lastOperation: 'specified_roll_call', lastStudentDisplayName: '乐乐' } }),
    }))
    expect(speech.calls.map(c => c.text)).toEqual(['请你来说一说，朵朵。', '乐乐，请你来回答吧。'])
    screen.wrapper.unmount()
  })

  it('#11 语音合成不可用时保留合法字幕，不宣称播放完成', async () => {
    speech.available = false
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 121, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(0)
    expect(captionText(screen.wrapper)).toBe('请你来说一说，朵朵。')
    expect(screen.digitalHuman.isSpeaking).toBe(false)
    screen.wrapper.unmount()
  })

  it('#12 课堂业务结果不存在时不产生任何播报', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: {}, interactionState: {} }) }))
    expect(speech.calls).toHaveLength(0)
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)
    screen.wrapper.unmount()
  })

  it('#13 教师接管（manualInterventionRequired）时不自动播报，并取消正在播放的播报', async () => {
    const screen = await mountScreen(screenState())
    await screen.push(screenState({ classroomState: classroomRun({ rollCallState: { lastRecordId: 131, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' } }) }))
    expect(speech.calls).toHaveLength(1)
    const stopsBefore = speech.stops

    await screen.push(screenState({
      classroomState: classroomRun({
        manualInterventionRequired: true,
        rollCallState: { lastRecordId: 131, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' },
      }),
    }))
    expect(speech.stops).toBeGreaterThan(stopsBefore)
    expect(screen.wrapper.find('[data-test="screen-announcement"]').exists()).toBe(false)

    // 接管状态下新的正式业务结果只登记、不播报（教师本人讲述，不假装数字人已播报）。
    await screen.push(screenState({
      classroomState: classroomRun({
        manualInterventionRequired: true,
        rollCallState: { lastRecordId: 132, lastOperation: 'random_roll_call', lastStudentDisplayName: '乐乐' },
      }),
    }))
    expect(speech.calls).toHaveLength(1)
    screen.wrapper.unmount()
  })
})
