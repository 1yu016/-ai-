import { describe, expect, it } from 'vitest'
import { buildRunRewardLeaderboard } from '@/services/rewardLeaderboard'
import type { RewardRecord } from '@/services/classroomCheckpoint'

const rec = (
  id: number,
  studentId: number,
  studentName: string,
  stars: number,
): RewardRecord => ({
  id, studentId, studentName, classId: 1, classroomRunId: 9, teacherId: 1,
  teacherName: '王雪梅', rewardType: 'flower', stars, reason: '积极回答',
  requestId: `r${id}`, createdAt: '2026-10-02T08:00:00.000Z',
})

describe('buildRunRewardLeaderboard（共享本节榜算法）', () => {
  it('#13/#14 相同 student 多条记录正确 SUM', () => {
    const list = buildRunRewardLeaderboard([
      rec(1, 1, '朵朵', 1),
      rec(3, 1, '朵朵', 1),
      rec(5, 1, '朵朵', 1),
    ])
    expect(list).toHaveLength(1)
    expect(list[0]!.studentName).toBe('朵朵')
    expect(list[0]!.totalStars).toBe(3)
    expect(list[0]!.rank).toBe(1)
  })

  it('#15 Top5 最多 5 人', () => {
    const records: RewardRecord[] = [1, 2, 3, 4, 5, 6, 7].map((id) => rec(id, id, `幼儿${id}`, 1))
    const list = buildRunRewardLeaderboard(records)
    expect(list).toHaveLength(5)
  })

  it('#16 tie 按 studentId 升序稳定', () => {
    // 阳阳(2) 与 糖糖(3) 同星，按 studentId 升序 → 阳阳在前。
    const list = buildRunRewardLeaderboard([
      rec(2, 3, '糖糖', 2),
      rec(1, 2, '阳阳', 2),
      rec(4, 1, '朵朵', 3),
    ])
    expect(list.map((l) => l.studentId)).toEqual([1, 2, 3])
    expect(list.map((l) => l.rank)).toEqual([1, 2, 3])
    expect(list.map((l) => l.totalStars)).toEqual([3, 2, 2])
  })

  it('#17 空输入返回空数组', () => {
    expect(buildRunRewardLeaderboard([])).toEqual([])
  })

  it('rank 从 1 连续编号，与排序一致', () => {
    const list = buildRunRewardLeaderboard([
      rec(1, 5, '乐乐', 1),
      rec(2, 1, '朵朵', 3),
    ])
    expect(list.map((l) => ({ id: l.studentId, rank: l.rank }))).toEqual([
      { id: 1, rank: 1 },
      { id: 5, rank: 2 },
    ])
  })
})