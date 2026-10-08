import type { RewardRecord } from './classroomCheckpoint'
import { buildRunRewardLeaderboard } from './rewardLeaderboard'

/**
 * 课堂总结：本节奖励汇总（纯函数，便于单测）。
 * 数据来源只认「本节课正式 RewardRecord」→ GET /classroom-runs/:runId/rewards。
 * 严禁混用班级累计榜（/classes/:classId/rewards）——那是全部历史，不是本节。
 * 聚合/排序统一委托 buildRunRewardLeaderboard，本节只追加总量与次数，避免两套算法。
 */

export type LeaderboardLine = {
  studentId: number
  studentName: string
  totalStars: number
}

export type RewardSummary = {
  /** 本节奖励总星数 */
  totalStars: number
  /** 本节奖励次数（RewardRecord 条数） */
  rewardCount: number
  /** 全部有奖励学生按 totalStars DESC, studentId ASC 排序 */
  byStudent: LeaderboardLine[]
  /** 展示用 Top N（默认前 5），不足 N 时只含实际有奖励的人 */
  top: LeaderboardLine[]
}

export function summarizeRunRewards(items: RewardRecord[], topN = 5): RewardSummary {
  // 拉全量做排序，再本地截 TopN，保证 byStudent/top 口径一致。
  const ranked = buildRunRewardLeaderboard(items, Math.max(items.length, topN))
  const byStudent: LeaderboardLine[] = ranked.map((line) => ({
    studentId: line.studentId,
    studentName: line.studentName,
    totalStars: line.totalStars,
  }))
  const totalStars = items.reduce(
    (sum, r) => sum + (Number.isFinite(r.stars) ? r.stars : 0),
    0,
  )
  return {
    totalStars,
    rewardCount: items.length,
    byStudent,
    top: byStudent.slice(0, topN),
  }
}