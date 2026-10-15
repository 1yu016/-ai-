import type { RewardRecord } from './classroomCheckpoint'

/**
 * 本节奖励榜聚合并排序（唯一实现，杜绝"课堂榜单/总结榜单"两套算法）。
 * 数据来源只认「本节课正式 RewardRecord」→ GET /classroom-runs/:runId/rewards。
 * 规则：按 studentId 聚合 SUM(stars)，totalStars DESC，同分 studentId ASC，最多前 topN（默认 5）。
 */

export type RunRewardLeaderboardItem = {
  rank: number
  studentId: number
  studentName: string
  totalStars: number
}

export function buildRunRewardLeaderboard(
  records: RewardRecord[],
  topN = 5,
): RunRewardLeaderboardItem[] {
  const map = new Map<number, { studentId: number; studentName: string; totalStars: number }>()
  for (const r of records) {
    const stars = Number.isFinite(r.stars) ? r.stars : 0
    const current = map.get(r.studentId)
    if (current) {
      current.totalStars += stars
      if (!current.studentName && r.studentName) current.studentName = r.studentName
    } else {
      map.set(r.studentId, {
        studentId: r.studentId,
        studentName: r.studentName ?? '',
        totalStars: stars,
      })
    }
  }
  return [...map.values()]
    .sort((a, b) => b.totalStars - a.totalStars || a.studentId - b.studentId)
    .slice(0, topN)
    .map((line, index) => ({ ...line, rank: index + 1 }))
}