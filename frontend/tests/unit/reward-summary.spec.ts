import { describe, expect, it } from 'vitest'
import type { RewardRecord } from '@/services/classroomCheckpoint'
import { summarizeRunRewards } from '@/services/rewardSummary'

function rec(over: Partial<RewardRecord>): RewardRecord {
  return {
    id: 1, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9,
    teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1,
    reason: '积极回答', requestId: 'reward-x', createdAt: '2026-10-02T08:00:00.000Z',
    ...over,
  }
}

describe('summarizeRunRewards · 本节课奖励聚合', () => {
  it('#1 奖励聚合正确：不同学生各自求和', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, studentName: '朵朵', stars: 1 }),
      rec({ id: 2, studentId: 2, studentName: '阳阳', stars: 2 }),
    ])
    expect(s.totalStars).toBe(3)
    expect(s.rewardCount).toBe(2)
    expect(s.byStudent).toHaveLength(2)
  })

  it('#2 同一学生多条 RewardRecord 正确求和', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, stars: 1 }),
      rec({ id: 2, studentId: 1, stars: 1 }),
      rec({ id: 3, studentId: 1, stars: 1 }),
    ])
    expect(s.byStudent).toHaveLength(1)
    expect(s.byStudent[0]).toMatchObject({ studentId: 1, studentName: '朵朵', totalStars: 3 })
    expect(s.totalStars).toBe(3)
    expect(s.rewardCount).toBe(3)
  })

  it('#3 排序正确：totalStars DESC', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, stars: 1 }),
      rec({ id: 2, studentId: 2, stars: 2 }),
      rec({ id: 3, studentId: 3, stars: 3 }),
    ])
    expect(s.byStudent.map((x) => x.studentId)).toEqual([3, 2, 1])
  })

  it('#3 同一学生多条：按总和而非条数排序', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, stars: 2 }),
      rec({ id: 2, studentId: 2, stars: 1 }),
      rec({ id: 3, studentId: 1, stars: 2 }),
    ])
    expect(s.byStudent[0]).toMatchObject({ studentId: 1, totalStars: 4 })
    expect(s.byStudent[1]).toMatchObject({ studentId: 2, totalStars: 1 })
  })

  it('#4 同分按 studentId ASC 稳定排序', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 5, stars: 2 }),
      rec({ id: 2, studentId: 2, stars: 2 }),
      rec({ id: 3, studentId: 9, stars: 2 }),
    ])
    expect(s.byStudent.map((x) => x.studentId)).toEqual([2, 5, 9])
  })

  it('#5 最多显示 Top5', () => {
    const s = summarizeRunRewards(
      Array.from({ length: 8 }, (_, i) =>
        rec({ id: i + 1, studentId: i + 1, studentName: `宝宝${i + 1}`, stars: 8 - i }),
      ),
    )
    expect(s.byStudent).toHaveLength(8)
    expect(s.top).toHaveLength(5)
    expect(s.top.map((x) => x.studentId)).toEqual([1, 2, 3, 4, 5])
  })

  it('#6 少于 5 人：只显示实际有奖励的人', () => {
    const s = summarizeRunRewards([rec({ id: 1, studentId: 1, stars: 1 })])
    expect(s.top).toHaveLength(1)
    expect(s.top[0]!.studentId).toBe(1)
  })

  it('#7 无奖励空态：byStudent 与 top 均空，计数为 0', () => {
    const s = summarizeRunRewards([])
    expect(s.byStudent).toHaveLength(0)
    expect(s.top).toHaveLength(0)
    expect(s.totalStars).toBe(0)
    expect(s.rewardCount).toBe(0)
  })

  it('#8 totalStars 正确（含多条累加）', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, stars: 3 }),
      rec({ id: 2, studentId: 2, stars: 1 }),
    ])
    expect(s.totalStars).toBe(4)
  })

  it('#9 rewardCount 为 RewardRecord 条数（非幼儿数）', () => {
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, stars: 1 }),
      rec({ id: 2, studentId: 1, stars: 1 }),
      rec({ id: 3, studentId: 2, stars: 1 }),
    ])
    expect(s.rewardCount).toBe(3)
    expect(s.byStudent).toHaveLength(2)
  })

  it('#14 输入即本节 RewardRecord：不掺入班级累计概念', () => {
    // 聚合只依赖 items，与班级累计榜解耦；只喂本节记录。
    const s = summarizeRunRewards([
      rec({ id: 1, studentId: 1, stars: 2 }),
      rec({ id: 2, studentId: 2, stars: 1 }),
    ])
    expect(s.totalStars).toBe(3)
    expect(s.top[0]!).toMatchObject({ studentId: 1, totalStars: 2 })
  })
})