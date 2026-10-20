import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_STALE_MS,
  ClassroomVoiceFeedback,
  classroomAnnouncementCandidates,
  createAnnouncementLedger,
  type AnnouncementLedgerStorage,
  type AnnouncementSource,
} from '@/classroom/feedback/ClassroomVoiceFeedback'

function memoryStorage(): AnnouncementLedgerStorage {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) },
  }
}

function instance(storage: AnnouncementLedgerStorage | null, key = 'ledger') {
  return new ClassroomVoiceFeedback(createAnnouncementLedger(storage, key))
}

const SERVER_NOW = '2026-10-20T10:00:00.000Z'
const fresh = (offsetMs = 0) => new Date(Date.parse(SERVER_NOW) - offsetMs).toISOString()

function candidates(overrides: Partial<AnnouncementSource> = {}) {
  return classroomAnnouncementCandidates({ runId: 77, serverNow: SERVER_NOW, ...overrides })
}

describe('classroomAnnouncementCandidates', () => {
  it('随机点名播报正式选中的学生称呼', () => {
    const list = candidates({
      rollCall: { lastRecordId: 31, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵', updatedAt: fresh() },
    })
    expect(list).toHaveLength(1)
    expect(list[0]!.kind).toBe('random_roll_call')
    expect(list[0]!.text).toBe('请你来说一说，朵朵。')
    expect(list[0]!.key).toBe('77:random_roll_call:31')
  })

  it('指定点名播报邀请语，分组点名使用分组模板', () => {
    const specified = candidates({
      rollCall: { lastRecordId: 32, lastOperation: 'specified_roll_call', lastStudentDisplayName: '乐乐', updatedAt: fresh() },
    })
    expect(specified[0]!.text).toBe('乐乐，请你来回答吧。')

    const group = candidates({
      rollCall: { lastRecordId: 33, lastOperation: 'group_roll_call', lastStudentDisplayName: '太阳组', updatedAt: fresh() },
    })
    expect(group[0]!.text).toBe('太阳组，请你代表小组分享吧。')
  })

  it('个人奖励自动播报使用固定模板，不把自定义表扬当成安全批准', () => {
    const list = candidates({
      reward: {
        recordId: 41, displayName: '乐乐', stars: 2, points: 2, praiseText: '你认真思考的样子真棒！',
        createdAt: fresh(),
      },
    })
    expect(list[0]!.kind).toBe('student_reward')
    expect(list[0]!.text).toBe('乐乐，你真棒！得到两朵小红花。')
    expect(list[0]!.key).toBe('77:student_reward:41')
  })

  it('缺少表扬文本时按权威数量使用固定模板', () => {
    const stars = candidates({ reward: { recordId: 42, displayName: '乐乐', stars: 2, points: 2, praiseText: null, createdAt: fresh() } })
    expect(stars[0]!.text).toBe('乐乐，你真棒！得到两朵小红花。')

    const points = candidates({ reward: { recordId: 43, displayName: '乐乐', stars: 0, points: 5, createdAt: fresh() } })
    expect(points[0]!.text).toBe('乐乐，你真棒！获得五点成长能量。')
  })

  it('集体奖励：优先使用记录自身的积分投影', () => {
    const list = candidates({ collectiveReward: { recordId: 51, points: 3, createdAt: fresh() } })
    expect(list[0]!.kind).toBe('collective_reward')
    expect(list[0]!.text).toBe('小朋友们一起努力，获得三点成长能量，真棒！')
    expect(list[0]!.key).toBe('77:collective_reward:51')
  })

  it('无正式时间的累计投影不能冒充新奖励；补读正式记录后使用单条积分', () => {
    const list = candidates({ collectiveState: { recordIds: [44, 52], points: 5 } })
    expect(list).toEqual([])
    const formal = candidates({ collectiveReward: { recordId: 52, points: 3, createdAt: fresh() } })
    expect(formal[0]!.kind).toBe('collective_reward')
    expect(formal[0]!.text).toBe('小朋友们一起努力，获得三点成长能量，真棒！')
    // 身份取最新一条正式记录，与「记录自身积分」路径共用同一去重键。
    expect(formal[0]!.key).toBe('77:collective_reward:52')
    expect(candidates({ collectiveState: { recordIds: [], points: 0 } })).toHaveLength(0)
    expect(candidates({ collectiveState: { recordIds: [53], points: 0 } })).toHaveLength(0)
  })

  it('步骤切换只播报简短过渡语，且不播报第 0 步', () => {
    const list = candidates({ step: { stepIndex: 2, title: '认识颜色' } })
    expect(list[0]!.text).toBe('接下来，我们进入：认识颜色。')
    expect(candidates({ step: { stepIndex: 0, title: '导入' } })).toHaveLength(0)
  })

  it('缺少正式身份或称呼时不生成播报', () => {
    expect(candidates({ rollCall: { lastRecordId: 1, lastOperation: 'random_roll_call', lastStudentDisplayName: '', updatedAt: fresh() } })).toHaveLength(0)
    expect(candidates({ rollCall: { lastRecordId: 1, lastOperation: 'unknown', lastStudentDisplayName: '朵朵', updatedAt: fresh() } })).toHaveLength(0)
    expect(candidates({ rollCall: { lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵', updatedAt: fresh() } })).toHaveLength(0)
    expect(candidates({ reward: { offset: 1, displayName: '乐乐', stars: 1, createdAt: fresh() } } as unknown as Partial<AnnouncementSource>)).toHaveLength(0)
    expect(candidates({ reward: { recordId: 61, displayName: '', stars: 1, createdAt: fresh() } })).toHaveLength(0)
    expect(candidates({ step: { stepIndex: 1, title: '' } })).toHaveLength(0)
  })

  it('超长称呼与超长步骤标题不进入播报', () => {
    expect(candidates({
      rollCall: { lastRecordId: 71, lastOperation: 'random_roll_call', lastStudentDisplayName: '一二三四五六七八九十一二三四五六七八九十甲', updatedAt: fresh() },
    })).toHaveLength(0)
    expect(candidates({ step: { stepIndex: 1, title: '这是一个明显超过二十四个字的教学内容环节标题需要被拒绝' } })).toHaveLength(0)
  })

  it('过期业务结果直接丢弃，不补播', () => {
    const stale = candidates({
      rollCall: {
        lastRecordId: 81, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵',
        updatedAt: fresh(ANNOUNCEMENT_STALE_MS + 1000),
      },
    })
    expect(stale).toHaveLength(0)
    // 缺少时间先拒播，调用方可从现有正式只读接口补齐。
    expect(candidates({
      rollCall: { lastRecordId: 82, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵' },
    })).toHaveLength(0)
  })

  it('同时出现多条正式结果时按重要性排序（奖励 > 集体 > 点名 > 步骤）', () => {
    const list = candidates({
      reward: { recordId: 91, displayName: '乐乐', stars: 1, createdAt: fresh() },
      collectiveReward: { recordId: 92, points: 1, createdAt: fresh() },
      rollCall: { lastRecordId: 93, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵', updatedAt: fresh() },
      step: { stepIndex: 3, title: '分享时间' },
    })
    expect(list.map(item => item.kind)).toEqual(['student_reward', 'collective_reward', 'random_roll_call', 'step_start'])
  })
})

describe('ClassroomVoiceFeedback.sync', () => {
  const rollCall = (recordId: number, name = '朵朵') => candidates({
    rollCall: { lastRecordId: recordId, lastOperation: 'random_roll_call', lastStudentDisplayName: name, updatedAt: fresh() },
  })

  it('某个 Run 的首轮只建立基线，刷新 / 新开大屏不会重放旧表扬', () => {
    const storage = memoryStorage()
    const first = instance(storage)
    expect(first.sync({ runId: 77, candidates: rollCall(101), allowed: true, mediaPlaying: false })).toBeNull()
    // 同一台账在刷新后的新实例：旧身份不会再次播报。
    const afterRefresh = instance(storage)
    expect(afterRefresh.sync({ runId: 77, candidates: rollCall(101), allowed: true, mediaPlaying: false })).toBeNull()
  })

  it('同一正式记录不会因为重试 / 重复投影重复播报', () => {
    const feedback = instance(memoryStorage())
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    const announced = feedback.sync({ runId: 77, candidates: rollCall(111), allowed: true, mediaPlaying: false })
    expect(announced?.key).toBe('77:random_roll_call:111')
    expect(feedback.sync({ runId: 77, candidates: rollCall(111), allowed: true, mediaPlaying: false })).toBeNull()
  })

  it('新一轮正式记录逐条排队，不永久丢掉同轮点名', () => {
    const feedback = instance(memoryStorage())
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    const announced = feedback.sync({
      runId: 77,
      allowed: true,
      mediaPlaying: false,
      candidates: candidates({
        reward: { recordId: 121, displayName: '乐乐', stars: 2, createdAt: fresh() },
        rollCall: { lastRecordId: 122, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵', updatedAt: fresh() },
      }),
    })
    expect(announced?.kind).toBe('student_reward')
    expect(feedback.next()?.key).toBe('77:random_roll_call:122')
    expect(feedback.sync({ runId: 77, candidates: rollCall(122), allowed: true, mediaPlaying: false })).toBeNull()
  })

  it('课堂状态不允许播报时直接丢弃，不补播', () => {
    const feedback = instance(memoryStorage())
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    expect(feedback.sync({ runId: 77, candidates: rollCall(131), allowed: false, mediaPlaying: false })).toBeNull()
    expect(feedback.sync({ runId: 77, candidates: rollCall(131), allowed: true, mediaPlaying: false })).toBeNull()
  })

  it('资源音频播放中丢弃课堂操作播报，且不会在资源停止后补播', () => {
    const feedback = instance(memoryStorage())
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    expect(feedback.sync({ runId: 77, candidates: rollCall(141), allowed: true, mediaPlaying: true })).toBeNull()
    expect(feedback.sync({ runId: 77, candidates: rollCall(141), allowed: true, mediaPlaying: false })).toBeNull()
  })

  it('切换到新的 Run 时重新建立基线，旧课堂记录不会进入新课堂', () => {
    const storage = memoryStorage()
    const feedback = instance(storage)
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    expect(feedback.sync({ runId: 77, candidates: rollCall(151), allowed: true, mediaPlaying: false })?.text).toBe('请你来说一说，朵朵。')
    // 新课堂：同一条记录 ID 属于旧 Run，新的 Run 只登记基线。
    expect(feedback.sync({ runId: 88, candidates: candidates({ runId: 88, rollCall: { lastRecordId: 151, lastOperation: 'random_roll_call', lastStudentDisplayName: '朵朵', updatedAt: fresh() } }), allowed: true, mediaPlaying: false })).toBeNull()
    expect(feedback.sync({
      runId: 88, allowed: true, mediaPlaying: false,
      candidates: candidates({ runId: 88, rollCall: { lastRecordId: 152, lastOperation: 'specified_roll_call', lastStudentDisplayName: '乐乐', updatedAt: fresh() } }),
    })?.text).toBe('乐乐，请你来回答吧。')
  })

  it('存储不可用（隐私模式）时退化为内存台账，本页面内仍不重复', () => {
    const feedback = instance(null)
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    expect(feedback.sync({ runId: 77, candidates: rollCall(161), allowed: true, mediaPlaying: false })?.key).toBe('77:random_roll_call:161')
    expect(feedback.sync({ runId: 77, candidates: rollCall(161), allowed: true, mediaPlaying: false })).toBeNull()
  })

  it('台账损坏时安全回退，不阻塞播报', () => {
    const storage = memoryStorage()
    storage.setItem('ledger', '{ this is not json')
    const feedback = instance(storage)
    feedback.sync({ runId: 77, candidates: [], allowed: true, mediaPlaying: false })
    expect(feedback.sync({ runId: 77, candidates: rollCall(171), allowed: true, mediaPlaying: false })?.key).toBe('77:random_roll_call:171')
  })
})
