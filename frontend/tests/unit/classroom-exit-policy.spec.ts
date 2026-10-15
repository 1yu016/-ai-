import { describe, expect, it } from 'vitest'
import { requiresClassroomExitConfirmation } from '@/router/classroomExitPolicy'

describe('课堂离开策略', () => {
  it('进行中和暂停的课堂需要确认，已结束课堂可以正常离开', () => {
    expect(requiresClassroomExitConfirmation('running')).toBe(true)
    expect(requiresClassroomExitConfirmation('paused')).toBe(true)
    for (const status of ['completed', 'cancelled', 'failed', undefined]) {
      expect(requiresClassroomExitConfirmation(status)).toBe(false)
    }
  })
})
