import { expect, it } from 'vitest'
import { classifyPublicSpeech } from '@/services/classroomListening'

it('routes a natural example followup to the fully reviewed dialogue instead of silently dropping it', () => {
  expect(classifyPublicSpeech('再举一个例子，只用一个短句回答，不要追问。').kind).toBe('question')
})
it('never turns an example containing teacher operations into an executable public command', () => {
  expect(classifyPublicSpeech('再举一个例子，奖励小朋友').kind).toBe('teacher_intent')
})
