/**
 * D-11 课堂操作语音反馈：把「权威业务结果」变成一句简短、适龄的中文播报。
 *
 * 设计约束：
 * - 只读权威课堂状态（正式点名记录 / 正式奖励记录 / 当前教学步骤），不产生新的课堂事实；
 * - 不使用 AI 识别意图代替正式业务结果，也不在结果未知时假装成功；
 * - 只播报对孩子有意义的课堂互动，课堂生命周期（开场 / 暂停 / 课间 / 结束）由既有阶段政策处理；
 * - 播报身份 = runId + 正式记录 ID；当前页面去重，sessionStorage 仅延续当前标签页；
 * - 过期播报直接丢弃，不为「补播」打断正在进行的教学。
 */

export type ClassroomAnnouncementKind =
  | 'random_roll_call'
  | 'specified_roll_call'
  | 'group_roll_call'
  | 'student_reward'
  | 'collective_reward'
  | 'step_start'

export type ClassroomAnnouncement = Readonly<{
  /** 去重身份：同一条正式业务记录只播报一次。 */
  key: string
  kind: ClassroomAnnouncementKind
  text: string
  /** Server event time, never a browser wall-clock timestamp. */
  occurredAt?: number
}>

/** 以下输入结构刻意使用 unknown 字段：课堂状态投影是动态 JSON，投影字段名可能变化，取值一律做运行时收敛。 */
export type RollCallStateLike = {
  lastRecordId?: unknown
  lastOperation?: unknown
  lastStudentDisplayName?: unknown
  updatedAt?: unknown
}

export type RewardPresentationLike = {
  recordId?: unknown
  displayName?: unknown
  stars?: unknown
  points?: unknown
  rewardCategory?: unknown
  praiseText?: unknown
  createdAt?: unknown
}

export type CollectiveRewardPresentationLike = {
  recordId?: unknown
  points?: unknown
  rewardCategory?: unknown
  reason?: unknown
  createdAt?: unknown
}

/** 正式集体奖励累计投影：recordIds 为未撤销的正式记录 ID（升序），points 为未撤销记录之和。 */
export type CollectiveRewardStateLike = {
  recordIds?: unknown
  points?: unknown
}

export type AnnouncementSource = {
  runId: number
  rollCall?: RollCallStateLike | null
  reward?: RewardPresentationLike | null
  collectiveReward?: CollectiveRewardPresentationLike | null
  /** 集体奖励的权威累计投影；新建的集体奖励记录从这里取得正式身份（presentation 只在撤销流程中维护）。 */
  collectiveState?: CollectiveRewardStateLike | null
  step?: { stepIndex?: unknown; title?: unknown } | null
  /** 服务端时间（课堂状态快照的 serverNow），用于判断播报是否过期，避免设备时钟差异。 */
  serverNow?: unknown
}

/** 超过该时长的业务结果不再补播（网络恢复 / 大屏重新上线时丢弃旧表扬）。 */
export const ANNOUNCEMENT_STALE_MS = 45_000

const PUBLIC_NAME_LIMIT = 20
const STEP_TITLE_LIMIT = 24
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
// These slots are identifiers, not free-form speech. Fail closed for sentences,
// contact details, invisible formatting and negative/unsafe labels.
const UNSAFE_SLOT = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]|\d{5}|电话|地址|住址|身份证|笨|坏孩子|差生|倒数|没用|最差|去死|自杀|色情|脱衣|打人|杀|刺|砍|喝药|消毒液|清洁剂|老师说|结束课堂|奖励|https?:|www\./i

/** 学生称呼：只做称呼用途，剔除控制字符并限长，禁止附加任何评价性描述。 */
function displayNameOf(value: unknown): string {
  if (typeof value !== 'string' || UNSAFE_SLOT.test(value.normalize('NFKC'))) return ''
  const name = value.normalize('NFKC').trim()
  if (!/^[\p{L}·・' -]+$/u.test(name)) return ''
  return name.length > 0 && name.length <= PUBLIC_NAME_LIMIT ? name : ''
}

function stepTitleOf(value: unknown): string {
  if (typeof value !== 'string' || UNSAFE_SLOT.test(value.normalize('NFKC'))) return ''
  const title = String(value ?? '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
  return title.length > 0 && title.length <= STEP_TITLE_LIMIT ? title : ''
}

const CHINESE_NUMERALS: Record<number, string> = { 1: '一', 2: '两', 3: '三', 4: '四', 5: '五' }
function numeral(value: number): string {
  return CHINESE_NUMERALS[value] ?? String(value)
}

function positiveCount(value: unknown): number {
  const count = Number(value)
  return Number.isSafeInteger(count) && count > 0 ? count : 0
}

/** 已复核的固定短句模板，只填入权威业务数据，不做任何负面评价或排名暗示。 */
const RANDOM_ROLL_CALL = (name: string) => `请你来说一说，${name}。`
const SPECIFIED_ROLL_CALL = (name: string) => `${name}，请你来回答吧。`
const GROUP_ROLL_CALL = (name: string) => `${name}，请你代表小组分享吧。`
const STUDENT_REWARD = (name: string, stars: number, points: number) => {
  if (stars > 0) return `${name}，你真棒！得到${numeral(stars)}朵小红花。`
  if (points > 0) return `${name}，你真棒！获得${numeral(points)}点成长能量。`
  return `${name}，你真棒！`
}
const COLLECTIVE_REWARD = (points: number) =>
  points > 0 ? `小朋友们一起努力，获得${numeral(points)}点成长能量，真棒！` : '小朋友们一起努力，真棒！'
const STEP_START = (title: string) => `接下来，我们进入：${title}。`

function ageMs(createdAt: unknown, serverNow: unknown): number | null {
  if (typeof createdAt !== 'string' || typeof serverNow !== 'string') return null
  const created = Date.parse(createdAt)
  const now = Date.parse(serverNow)
  if (!Number.isFinite(created) || !Number.isFinite(now)) return null
  return now - created
}

const stale = (createdAt: unknown, serverNow: unknown) => {
  const age = ageMs(createdAt, serverNow)
  return age === null || age < -1000 || age > ANNOUNCEMENT_STALE_MS
}

const recordKey = (runId: number, kind: ClassroomAnnouncementKind, recordId: unknown) =>
  Number.isSafeInteger(recordId) && Number(recordId) > 0 ? `${runId}:${kind}:${recordId}` : null

/**
 * 候选播报（按对孩子的重要性排序：奖励 > 集体奖励 > 点名 > 步骤过渡）。
 * 只返回具备完整权威身份的条目；过期条目直接丢弃，不会在稍后被补播。
 */
export function classroomAnnouncementCandidates(source: AnnouncementSource): ClassroomAnnouncement[] {
  const { runId, serverNow } = source
  if (!Number.isSafeInteger(runId) || runId <= 0) return []
  const candidates: ClassroomAnnouncement[] = []

  const reward = source.reward
  if (reward) {
    const key = recordKey(runId, 'student_reward', reward.recordId)
    const name = displayNameOf(reward.displayName)
    if (key && name && !stale(reward.createdAt, serverNow)) {
      // Arbitrary teacher-confirmed praise is not a whole-reply safety approval.
      // Only the fixed positive template is automatically read here.
      const text = STUDENT_REWARD(name, positiveCount(reward.stars), positiveCount(reward.points))
      candidates.push({ key, kind: 'student_reward', text, occurredAt: Date.parse(String(reward.createdAt)) })
    }
  }

  const collective = source.collectiveReward
  // Cumulative/revoke projections have no event time. The read adapter must supply
  // a still-active formal record with its own points and createdAt.
  const collectiveRecordId = Number(collective?.recordId)
  if (Number.isSafeInteger(collectiveRecordId) && collectiveRecordId > 0 && !stale(collective?.createdAt, serverNow)) {
    const key = recordKey(runId, 'collective_reward', collectiveRecordId)
    if (key) candidates.push({ key, kind: 'collective_reward', text: COLLECTIVE_REWARD(positiveCount(collective?.points)), occurredAt: Date.parse(String(collective?.createdAt)) })
  }

  const rollCall = source.rollCall
  if (rollCall) {
    const operation = String(rollCall.lastOperation ?? '')
    const kind: ClassroomAnnouncementKind | null =
      operation === 'random_roll_call' || operation === 'specified_roll_call' || operation === 'group_roll_call' ? operation : null
    const name = displayNameOf(rollCall.lastStudentDisplayName)
    const key = kind ? recordKey(runId, kind, rollCall.lastRecordId) : null
    if (kind && key && name && !stale(rollCall.updatedAt, serverNow)) {
      const text = kind === 'random_roll_call' ? RANDOM_ROLL_CALL(name)
        : kind === 'specified_roll_call' ? SPECIFIED_ROLL_CALL(name) : GROUP_ROLL_CALL(name)
      candidates.push({ key, kind, text, occurredAt: Date.parse(String(rollCall.updatedAt)) })
    }
  }

  if (source.step) {
    const stepIndex = Number(source.step.stepIndex)
    const stepTitle = stepTitleOf(source.step.title)
    if (Number.isSafeInteger(stepIndex) && stepIndex > 0 && stepTitle) {
      candidates.push({ key: `${runId}:step:${stepIndex}`, kind: 'step_start', text: STEP_START(stepTitle), occurredAt: Date.parse(String(serverNow)) })
    }
  }

  return candidates
}

export type AnnouncementLedgerStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type AnnouncementLedger = {
  seen(key: string): boolean
  mark(keys: string[]): void
  clear(): void
}

/**
 * 当前标签页台账。sessionStorage 不提供同设备多标签或跨设备全局去重。
 * 存储不可用（隐私模式等）时退化为内存台账，仍保证本页面内不重复。
 */
export function createAnnouncementLedger(
  storage: AnnouncementLedgerStorage | null,
  storageKey: string,
  limit = 80,
): AnnouncementLedger {
  let memory: string[] = []
  if (storage) {
    try {
      const raw = storage.getItem(storageKey)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) memory = parsed.filter((item): item is string => typeof item === 'string')
    } catch { memory = [] }
  }
  const persist = () => {
    if (!storage) return
    try { storage.setItem(storageKey, JSON.stringify(memory.slice(-limit))) }
    catch { /* 存储不可用时只保留内存台账 */ }
  }
  const set = new Set(memory)
  return {
    seen: key => set.has(key),
    mark: keys => {
      if (!keys.length) return
      for (const key of keys) { if (set.has(key)) continue; set.add(key); memory.push(key) }
      if (memory.length > limit) {
        const trimmed = memory.slice(-limit)
        // Keep page-lifetime identity knowledge even when persisted history is capped.
        memory = trimmed
      }
      persist()
    },
    clear: () => { memory = []; set.clear(); if (storage) { try { storage.removeItem(storageKey) } catch { /* 忽略 */ } } },
  }
}

export type AnnouncementSyncInput = {
  runId: number
  candidates: ClassroomAnnouncement[]
  /** 当前课堂状态是否允许数字人播报（进行中、非开场、非课间、非总结）。 */
  allowed: boolean
  /** 资源音频是否正在播放：媒体优先，此时丢弃课堂操作播报，避免抢话。 */
  mediaPlaying: boolean
  busy?: boolean
  serverNow?: string
  /** Includes identities without speech fields, so initial history is still consumed. */
  baselineKeys?: string[]
}

/**
 * 决定本轮是否播报。
 * - 第一次见到某个 Run 只登记基线（刷新 / 新开大屏不会重放旧表扬）；
 * - 状态不允许（暂停 / 课间 / 切换 Run 等）或媒体正在播放时，直接消费掉本轮身份（过期丢弃，不补播）；
 * - 同轮有效记录按正式时间有序排队；媒体抢占或政策变化丢弃队列，不补播。
 */
export class ClassroomVoiceFeedback {
  private baselineRunId: number | null = null
  private baselineIds = new Map<string, number>()
  private queue: Array<{ item: ClassroomAnnouncement; deadline: number }> = []
  constructor(private readonly ledger: AnnouncementLedger) {}

  sync(input: AnnouncementSyncInput): ClassroomAnnouncement | null {
    const fresh = input.candidates.filter(candidate => candidate.key.startsWith(`${input.runId}:`) && !this.ledger.seen(candidate.key))
    if (this.baselineRunId !== input.runId) {
      this.baselineRunId = input.runId
      this.queue = []
      this.baselineIds.clear()
      const keys = [...(input.baselineKeys ?? []), ...fresh.map(candidate => candidate.key)]
      for (const key of keys) {
        const [, kind, id] = key.split(':')
        const family = kind?.includes('roll_call') ? 'roll_call' : kind
        if (family && Number.isSafeInteger(Number(id))) this.baselineIds.set(family, Math.max(this.baselineIds.get(family) ?? 0, Number(id)))
      }
      this.ledger.mark(keys)
      return null
    }
    this.ledger.mark(fresh.map(candidate => candidate.key))
    if (!input.allowed || input.mediaPlaying) { this.queue = []; return null }
    const now = performance.now()
    for (const item of fresh) {
      const [, kind, id] = item.key.split(':')
      const family = kind?.includes('roll_call') ? 'roll_call' : kind
      if (family && Number(id) <= (this.baselineIds.get(family) ?? -1)) continue
      const serverTime = input.serverNow ? Date.parse(input.serverNow) : item.occurredAt
      const remaining = item.occurredAt !== undefined && serverTime !== undefined
        ? ANNOUNCEMENT_STALE_MS - (serverTime - item.occurredAt) : 0
      if (Number.isFinite(remaining) && remaining >= 0) this.queue.push({ item, deadline: now + remaining })
    }
    const priority = (item: ClassroomAnnouncement) => item.kind === 'student_reward' ? 0 : item.kind === 'collective_reward' ? 1 : item.kind === 'step_start' ? 3 : 2
    this.queue.sort((a, b) => (a.item.occurredAt ?? 0) - (b.item.occurredAt ?? 0) || priority(a.item) - priority(b.item) || a.item.key.localeCompare(b.item.key, 'en', { numeric: true }))
    // Bounded speech backlog; never keep an unbounded classroom history in memory.
    this.queue = this.queue.slice(-12)
    return input.busy ? null : this.next()
  }
  next(): ClassroomAnnouncement | null {
    const now = performance.now()
    while (this.queue.length) {
      const next = this.queue.shift()!
      if (next.deadline >= now) return next.item
    }
    return null
  }
  cancel() { this.queue = [] }
}
