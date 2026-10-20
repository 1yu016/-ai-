import { ClassroomContentSafetyService } from './classroom-content-safety.service';
import { jest } from '@jest/globals';

const allow = { decision: 'allow', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true };
describe('D7 unified child content admission', () => {
  const context = { ageGroup: '4-5', step: '观察圆形' };
  it('requires semantic review with age, complete content and history, not just absence of keywords', async () => {
    const review = jest.fn(async () => allow);
    const safety = new ClassroomContentSafetyService({ reviewClassroomContent: review } as never);
    expect(await safety.check('output', context, '圆形会滚。你发现了什么？', [], new AbortController().signal)).toBe(true);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ stage: 'output', context, content: '圆形会滚。你发现了什么？', history: [] }), expect.any(AbortSignal));
  });
  it.each([null, {}, { ...allow, decision: 'unknown' }, { ...allow, ageAppropriate: 'true' }, { ...allow, privacySafe: false }, { ...allow, contextAppropriate: false }, { ...allow, extra: 'untrusted' }])('fails closed on invalid review: %j', async value => {
    const safety = new ClassroomContentSafetyService({ reviewClassroomContent: async () => value } as never);
    expect(await safety.check('input', context, '为什么会滚？', [], new AbortController().signal)).toBe(false);
  });
  it('a semantic rejection catches disguised unsafe content without relying on a banned word', async () => {
    const safety = new ClassroomContentSafetyService({ reviewClassroomContent: async () => ({ ...allow, decision: 'redirect' }) } as never);
    expect(await safety.check('output', context, '把亮晶晶的小圆片放进嘴里试试。', [], new AbortController().signal)).toBe(false);
  });
  it('never sends obvious personal information to a remote reviewer', async () => {
    const review = jest.fn(); const safety = new ClassroomContentSafetyService({ reviewClassroomContent: review } as never);
    expect(await safety.check('input', context, '我的电话是13800138000', [], new AbortController().signal)).toBe(false);
    expect(review).not.toHaveBeenCalled();
  });
  it('times out an unresponsive reviewer and aborts its request', async () => {
    jest.useFakeTimers(); let signal!: AbortSignal;
    try {
      const safety = new ClassroomContentSafetyService({ reviewClassroomContent: (_value: unknown, incoming: AbortSignal) => { signal = incoming; return new Promise(() => {}); } } as never);
      const result = safety.check('output', context, '合成回答。', [], new AbortController().signal);
      await jest.advanceTimersByTimeAsync(5000);
      expect(await result).toBe(false); expect(signal.aborted).toBe(true);
    } finally { jest.useRealTimers(); }
  });
  it('reviewer errors never allow narration', async () => {
    const safety = new ClassroomContentSafetyService({ reviewClassroomContent: async () => { throw Error('unavailable'); } } as never);
    expect(await safety.check('output', context, '回答。', [], new AbortController().signal)).toBe(false);
  });
});
