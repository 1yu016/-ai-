import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { AvatarStateMachine } from '@/avatar/state/AvatarStateMachine'

describe('D2 classroom visual lifecycle', () => {
  afterEach(() => vi.useRealTimers())
  it('opening waves once, settles, and does not replay on resume', () => {
    vi.useFakeTimers(); setActivePinia(createPinia())
    const avatar = useDigitalHumanStore()
    avatar.transition({ type: 'lesson_opening' })
    expect(avatar.action).toBe('wave')
    vi.advanceTimersByTime(2800)
    expect(avatar.action).toBe('idle')
    avatar.setClassroomPaused(true); avatar.setClassroomPaused(false)
    expect(avatar.action).toBe('idle')
  })
  it('pause invalidates speech and blocks late starts until allowed again', () => {
    setActivePinia(createPinia()); const avatar = useDigitalHumanStore()
    avatar.transition({ type: 'tts_start' }); expect(avatar.action).toBe('talk')
    avatar.setClassroomPaused(true)
    avatar.transition({ type: 'tts_start' }); expect(avatar.action).toBe('idle')
    avatar.setClassroomPaused(false); expect(avatar.action).toBe('idle')
    avatar.transition({ type: 'tts_start' }); expect(avatar.action).toBe('talk')
    avatar.transition({ type: 'tts_end' }); expect(avatar.action).toBe('idle')
  })
  it('listening and praise settle without interrupting active speech', () => {
    const machine = new AvatarStateMachine()
    expect(machine.transition({ type: 'teacher_command', command: 'listen' }).state).toBe('listen')
    expect(machine.transition({ type: 'settle' }).state).toBe('idle')
    expect(machine.transition({ type: 'ai_response', emotion: 'encourage' }).state).toBe('encourage')
    machine.transition({ type: 'tts_start' })
    expect(machine.transition({ type: 'ai_response', emotion: 'happy' }).state).toBe('talk')
    expect(machine.transition({ type: 'step_change' }).state).toBe('idle')
  })
})
