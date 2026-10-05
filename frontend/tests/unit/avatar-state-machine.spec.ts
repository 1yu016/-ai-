import { describe, expect, it } from 'vitest'
import { AvatarStateMachine } from '@/avatar/state/AvatarStateMachine'

describe('avatar state machine', () => {
  it('starts at idle with neutral expression', () => {
    const machine = new AvatarStateMachine()
    expect(machine.snapshot()).toEqual({ state: 'idle', action: 'idle', expression: 'neutral' })
  })

  it('enters talk on tts_start and returns to idle on tts_end', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'tts_start' })
    expect(machine.snapshot().state).toBe('talk')
    expect(machine.snapshot().action).toBe('talk')
    expect(machine.snapshot().expression).toBe('neutral')

    machine.transition({ type: 'tts_end' })
    expect(machine.snapshot().state).toBe('idle')
  })

  it('maps ai_response emotions to corresponding states', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'ai_response', emotion: 'happy' })
    expect(machine.snapshot().state).toBe('happy')
    machine.transition({ type: 'settle' })
    expect(machine.snapshot().state).toBe('idle')

    machine.transition({ type: 'ai_response', emotion: 'question' })
    expect(machine.snapshot().state).toBe('question')
    machine.transition({ type: 'settle' })

    machine.transition({ type: 'ai_response', emotion: 'encourage' })
    expect(machine.snapshot().state).toBe('encourage')
    expect(machine.snapshot().action).toBe('encourage')
    machine.transition({ type: 'settle' })

    machine.transition({ type: 'ai_response', emotion: 'think' })
    expect(machine.snapshot().state).toBe('think')
    expect(machine.snapshot().expression).toBe('thinking')
    machine.transition({ type: 'tts_end' })
    expect(machine.snapshot().state).toBe('idle')

    machine.transition({ type: 'ai_response', emotion: 'neutral' })
    expect(machine.snapshot().state).toBe('idle')
  })

  it('does not interrupt talk when an ai_response arrives while speaking', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'tts_start' })
    machine.transition({ type: 'ai_response', emotion: 'happy' })
    expect(machine.snapshot().state).toBe('talk')
  })

  it('enters listen on teacher command and returns via settle/tts_end', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'teacher_command', command: 'listen' })
    expect(machine.snapshot().state).toBe('listen')
    machine.transition({ type: 'tts_start' })
    expect(machine.snapshot().state).toBe('talk')
  })

  it('resets to idle on step change', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'tts_start' })
    machine.transition({ type: 'step_change' })
    expect(machine.snapshot().state).toBe('idle')
  })

  it('enters goodbye on lesson_end and ignores further events', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'tts_start' })
    machine.transition({ type: 'lesson_end' })
    expect(machine.snapshot().state).toBe('goodbye')
    expect(machine.snapshot().action).toBe('goodbye')

    machine.transition({ type: 'tts_end' })
    machine.transition({ type: 'ai_response', emotion: 'happy' })
    machine.transition({ type: 'teacher_command', command: 'listen' })
    expect(machine.snapshot().state).toBe('goodbye')
  })

  it('settle returns emotional states to idle', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'ai_response', emotion: 'happy' })
    machine.transition({ type: 'settle' })
    expect(machine.snapshot().state).toBe('idle')
  })

  it('reset returns to idle', () => {
    const machine = new AvatarStateMachine()
    machine.transition({ type: 'tts_start' })
    machine.reset()
    expect(machine.snapshot().state).toBe('idle')
  })
})