import { ElMessage } from 'element-plus'
import { http } from '@/api/http'

export type Attendance = 'present' | 'late' | 'absent'
export type CheckpointType = 'roll_call' | 'reward'

export type RewardRecord = {
  id: number
  studentId: number
  studentName: string | null
  classId: number
  classroomRunId: number
  teacherId: number
  teacherName: string | null
  rewardType: string
  stars: number
  reason: string | null
  requestId: string
  createdAt: string
}

export type RewardResult = {
  record: RewardRecord
  rewardState: Record<number, number>
  studentTotal: number
}

export type RunRewardsPayload = {
  items: RewardRecord[]
  total: number
  runTitle: string
}

export type ActiveRun = {
  id: number
  version: number
  deviceId: number
  status: string
  currentStepIndex: number
  steps?: { title?: string }[]
}

export type RestoredClassroomState = {
  attendance: Record<number, Attendance>
  rewards: Record<number, number>
}

// 兼容旧版嵌套形状 { attendance: {...} } / { awards: {...} }，新版直接存储状态对象。
export function unpackState(state: unknown): Record<number, unknown> {
  if (!state || typeof state !== 'object') return {}
  const raw = state as Record<string, unknown>
  const body = (raw.attendance ?? raw.awards ?? raw) as
    | Record<string, unknown>
    | undefined
  if (!body || typeof body !== 'object') return {}
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [Number(key), value]),
  ) as Record<number, unknown>
}

/** 读取 run 的最新合法快照，未提供字段从后端继承，返回归一化后的考勤/奖励状态。 */
export async function restoreCheckpoint(
  run: ActiveRun,
): Promise<RestoredClassroomState> {
  try {
    const restored = await http.get<{
      attendanceState?: unknown
      rewardState?: unknown
    }>(`/classroom-runs/${run.id}/restore`, {
      params: { deviceId: run.deviceId },
    })
    return {
      attendance: unpackState(
        restored.data.attendanceState,
      ) as Record<number, Attendance>,
      rewards: unpackState(
        restored.data.rewardState,
      ) as Record<number, number>,
    }
  } catch {
    // 恢复失败时保留当前页面状态，返回空快照。
    return { attendance: {}, rewards: {} }
  }
}

/** 保存 checkpoint，协议：roll_call→attendanceState、reward→rewardState。 */
export async function saveCheckpoint(
  type: CheckpointType,
  run: ActiveRun | null,
  state: Record<string, unknown>,
): Promise<void> {
  if (!run) return
  try {
    await http.post(`/classroom-runs/${run.id}/checkpoints`, {
      requestId: `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: run.version,
      deviceId: run.deviceId,
      checkpointType: type,
      ...(type === 'roll_call'
        ? { attendanceState: state }
        : { rewardState: state }),
    })
  } catch {
    ElMessage.warning('课堂快照暂时未同步，已保留在当前页面。')
  }
}

/**
 * Stage 7.3：发奖励走正式 RewardRecord 写入口（原子事务 + requestId 幂等）。
 * 后端成功后返回 record + 最新 rewardState；失败时抛出异常，UI 不做乐观更新。
 */
export async function postReward(
  run: ActiveRun,
  studentId: number,
  stars = 1,
  reason?: string,
): Promise<RewardResult> {
  const requestId = `reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data } = await http.post<RewardResult>(
    `/classroom-runs/${run.id}/rewards`,
    {
      requestId,
      studentId,
      stars,
      reason: reason?.trim() || null,
    },
  )
  return data
}

/** Stage 7.3：本节课奖励明细（独立 RewardRecord，按时间正序）。 */
export async function listRunRewards(runId: number): Promise<RunRewardsPayload> {
  const { data } = await http.get<RunRewardsPayload>(
    `/classroom-runs/${runId}/rewards`,
  )
  return data
}

/** 把后端 ISO 时间格式化为 "HH:mm" / "MM-DD HH:mm"。 */
export function formatRewardTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay ? hm : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`
}
