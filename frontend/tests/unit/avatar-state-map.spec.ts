import { describe, expect, it } from 'vitest'
import {
  ACTION_TO_STATE,
  STATE_TO_AVATAR_ACTION,
  CONTINUOUS_AVATAR_STATES,
  toDigitalHumanState,
  toAvatarAction,
} from '@/components/digital-human/avatarStateMap'
import type { DigitalHumanAction } from '@/stores/digitalHuman'

describe('avatarStateMap · store.action → DigitalHumanState → Agent Robot Avatar action', () => {
  it('idle → DigitalHumanState idle → avatar idle', () => {
    expect(toDigitalHumanState('idle')).toBe('idle')
    expect(toAvatarAction('idle')).toBe('idle')
    expect(ACTION_TO_STATE.idle).toBe('idle')
  })

  it('listen → listening（持续态）→ avatar waiting', () => {
    expect(toDigitalHumanState('listen')).toBe('listening')
    expect(STATE_TO_AVATAR_ACTION.listening).toBe('waiting')
    expect(CONTINUOUS_AVATAR_STATES.has('listening')).toBe(true)
  })

  it('thinking → thinking → avatar inspect', () => {
    expect(toDigitalHumanState('thinking')).toBe('thinking')
    expect(toAvatarAction('thinking')).toBe('inspect')
  })

  it('talk → speaking → avatar send', () => {
    expect(toDigitalHumanState('talk')).toBe('speaking')
    expect(toAvatarAction('speaking')).toBe('send')
  })

  it('happy → happy → avatar success', () => {
    expect(toDigitalHumanState('happy')).toBe('happy')
    expect(toAvatarAction('happy')).toBe('success')
  })

  it('question → surprised（提问互动为好奇/疑问姿态）→ avatar surprise', () => {
    expect(toDigitalHumanState('question')).toBe('surprised')
    expect(toAvatarAction('surprised')).toBe('surprise')
  })

  it('encourage → encouraging / praise → celebrating / wave → greeting / goodbye → idle', () => {
    expect(toDigitalHumanState('encourage')).toBe('encouraging')
    expect(toAvatarAction('encouraging')).toBe('success')
    expect(toDigitalHumanState('praise')).toBe('celebrating')
    expect(toAvatarAction('celebrating')).toBe('success')
    expect(toDigitalHumanState('wave')).toBe('greeting')
    expect(toAvatarAction('greeting')).toBe('success')
    expect(toDigitalHumanState('goodbye')).toBe('idle')
    expect(toAvatarAction('idle')).toBe('idle')
  })

  it('error → avatar error（第三方存在系统错误表情）', () => {
    expect(toAvatarAction('error')).toBe('error')
  })

  it('守卫：未知 store action / 未知状态一律回退 idle，不向第三方透传脏值', () => {
    expect(toDigitalHumanState('unknown' as DigitalHumanAction)).toBe('idle')
    expect(toAvatarAction('unknown' as never)).toBe('idle')
  })

  it('除 listening 外无其他持续态（一次性动画用 play() 即可）', () => {
    expect(Array.from(CONTINUOUS_AVATAR_STATES)).toEqual(['listening'])
  })
})
