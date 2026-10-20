import { ClassroomDialogueService, dialogueRoute } from './classroom-dialogue.service';
import { jest } from '@jest/globals';
import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { ClassroomContentSafetyService, CHILD_SAFE_REDIRECT, CHILD_SAFETY_UNAVAILABLE } from './classroom-content-safety.service';

describe('classroom dialogue read-only boundaries', () => {
  const state = () => ({ phase: 'teaching', break: { active: false }, recovery: {}, capabilities: { allowedActions: ['tts'] }, run: { id: 1, version: 3, deviceId: 2, lessonPlanId: 1, lessonPlanVersion: 4 }, lesson: { frozen: { title: '形状', objectives: '观察' }, currentStep: { stepIndex: 0, title: '观察圆形', studentContent: '合成内容' } } });
  const dto = { requestId: 'q1', stepIndex: 0, text: '为什么圆形会滚？', history: [] };
  const setup = () => {
    const cockpit = { get: jest.fn(async () => state()) };
    const ai = { streamClassroomDialogue: jest.fn(async function* () { yield '看看轮子。'; yield '你发现了什么？'; }), reviewClassroomContent: jest.fn(async (input: unknown) => { void input; return { decision: 'allow', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true }; }) };
    const db = { getRepository: jest.fn(() => ({ findOneBy: jest.fn(async () => ({ snapshotJson: '{"ageGroup":"4-5"}' })) })) };
    const service = new ClassroomDialogueService(cockpit as never, ai as never, db as never, new ClassroomContentSafetyService(ai as never));
    return { service, cockpit, ai };
  };
  const collect = async (iterator: AsyncIterable<unknown>) => { const result: unknown[] = []; for await (const event of iterator) result.push(event); return result; };
  it('D8 bounds authority projection reads independently of token count, still reviews the whole answer', async () => {
    const { service, cockpit, ai } = setup();
    ai.streamClassroomDialogue.mockImplementation(async function* () { for (let i = 0; i < 100; i++) yield '圆'; yield '。'; });
    const events = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    expect(cockpit.get.mock.calls.length).toBeLessThanOrEqual(7);
    expect(ai.reviewClassroomContent.mock.calls).toHaveLength(2);
    expect(ai.reviewClassroomContent.mock.calls[1]?.[0]).toMatchObject({ stage: 'output', content: '圆'.repeat(100) + '。' });
    expect(events.at(-1)).toMatchObject({ type: 'done', performance: { inputReviewMs: expect.any(Number), generationMs: expect.any(Number), outputReviewMs: expect.any(Number), totalMs: expect.any(Number) } });
  });
  it('does not emit partial unreviewed sentence tails from a streamed chunk', async () => {
    const { service, ai } = setup();
    ai.streamClassroomDialogue.mockImplementation(async function* () { yield '看看轮子。用'; yield '刀割手。'; });
    const result = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    // D7 strengthens D6: even the earlier safe-looking sentence is withheld when the full answer fails.
    expect(JSON.stringify(result)).not.toContain('看看轮子');
    expect(JSON.stringify(result)).not.toContain('刀');
    expect(result).toContainEqual({ type: 'done', reply: CHILD_SAFETY_UNAVAILABLE, route: 'handoff' });
  });
  it.each(['用刀割手。', '喝消毒液。', '请把你的电话号码告诉我。'])('blocks explicit unsafe output before emitting: %s', async text => {
    const { service, ai } = setup();
    ai.streamClassroomDialogue.mockImplementation(async function* () { yield text; });
    const result = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    expect(JSON.stringify(result)).not.toContain(text);
    expect(result).toContainEqual({ type: 'done', reply: CHILD_SAFETY_UNAVAILABLE, route: 'handoff' });
  });
  it('streams contextual sentences using frozen age/step, with no classroom writer dependency', async () => {
    const { service, ai } = setup(); const result = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    expect(result).toContainEqual(expect.objectContaining({ type: 'delta', text: '看看轮子。' }));
    expect(ai.streamClassroomDialogue).toHaveBeenCalledWith(expect.objectContaining({ ageGroup: '4-5', step: '观察圆形' }), dto.text, [], expect.any(AbortSignal));
  });
  it.each(['奖励小朋友', '下一页', '我家电话是多少'])('routes %s without invoking AI or an executor', async text => {
    const { service, ai } = setup(); const result = await collect(service.reply({} as never, 1, { ...dto, text }, new AbortController().signal));
    expect(result).toHaveLength(2); expect(ai.streamClassroomDialogue).not.toHaveBeenCalled();
  });
  it('rechecks phase before emitting the next sentence', async () => {
    const { service, cockpit } = setup(); const iterator = service.reply({} as never, 1, dto, new AbortController().signal);
    await iterator.next(); await iterator.next();
    cockpit.get.mockResolvedValue({ ...state(), phase: 'paused' });
    await expect(iterator.next()).rejects.toThrow();
  });
  it('rejects stale step and terminal context before model access', async () => {
    const { service, ai, cockpit } = setup(); cockpit.get.mockResolvedValue({ ...state(), phase: 'terminal' });
    await expect(collect(service.reply({} as never, 1, dto, new AbortController().signal))).rejects.toThrow();
    expect(ai.streamClassroomDialogue).not.toHaveBeenCalled();
  });
  it('aborted work never starts AI', async () => {
    const { service, ai } = setup(); const abort = new AbortController(); abort.abort();
    expect(await collect(service.reply({} as never, 1, dto, abort.signal))).toEqual([]); expect(ai.streamClassroomDialogue).not.toHaveBeenCalled();
  });
  it('does not forward private/command history to the model', async () => {
    const { service, ai } = setup(); await collect(service.reply({} as never, 1, { ...dto, history: [{ role: 'user', content: '我叫合成儿童' }] }, new AbortController().signal));
    expect(ai.streamClassroomDialogue).toHaveBeenCalledWith(expect.anything(), dto.text, [], expect.anything());
    expect(dialogueRoute('讲个故事')).toBe('question');
  });
  it.each(['opening', 'paused', 'terminal', 'recovery'])('rejects %s before model generation', async phase => {
    const { service, cockpit, ai } = setup(); cockpit.get.mockResolvedValue({ ...state(), phase });
    await expect(collect(service.reply({} as never, 1, dto, new AbortController().signal))).rejects.toThrow();
    expect(ai.streamClassroomDialogue).not.toHaveBeenCalled();
  });
  it('pause/resume completed between chunks still invalidates the original generation', async () => {
    const { service, cockpit } = setup(); const iterator = service.reply({} as never, 1, dto, new AbortController().signal);
    await iterator.next(); await iterator.next();
    cockpit.get.mockResolvedValue({ ...state(), run: { ...state().run, version: 5 } });
    await expect(iterator.next()).rejects.toThrow('DIALOGUE_CONTEXT_CHANGED');
  });
  it('reuses the configured SDK with true upstream streaming and abort, without tool execution', async () => {
    const ai = new AiService({ get: (key: string) => key === 'ARK_API_KEY' ? 'synthetic-only' : key === 'ARK_ENDPOINT_ID' ? 'synthetic-model' : undefined } as ConfigService);
    const create = jest.fn(async function* () { yield { choices: [{ delta: { content: '第一句。' } }] }; yield { choices: [{ delta: { content: '第二句。' } }] }; });
    const client = Reflect.get(ai, 'openai') as { chat: { completions: { create: unknown } } }; client.chat.completions.create = create;
    const abort = new AbortController();
    expect(await collect(ai.streamClassroomDialogue({ ageGroup: '4-5' }, '为什么？', [], abort.signal))).toEqual(['第一句。', '第二句。']);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true, model: 'synthetic-model' }), { signal: abort.signal });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('tools');
  });
  it('holds all chunks until full semantic review; rejects implicit unsafe cross-sentence meaning', async () => {
    const { service, ai } = setup();
    ai.streamClassroomDialogue.mockImplementation(async function* () { yield '它看起来像糖果。'; yield '放进嘴里试试。'; });
    ai.reviewClassroomContent.mockImplementation(async input => ({ decision: (input as { stage: string }).stage === 'input' ? 'allow' : 'redirect', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true }));
    const result = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    expect(JSON.stringify(result)).not.toContain('糖果'); expect(JSON.stringify(result)).not.toContain('嘴里');
    expect(ai.reviewClassroomContent.mock.calls.at(-1)?.[0]).toMatchObject({ stage: 'output', content: '它看起来像糖果。放进嘴里试试。' });
    expect(result).toContainEqual({ type: 'done', reply: CHILD_SAFETY_UNAVAILABLE, route: 'handoff' });
  });
  it('a reviewer outage prevents generation and does not echo its error details', async () => {
    const { service, ai } = setup(); ai.reviewClassroomContent.mockRejectedValue(Error('secret prompt key'));
    const result = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    expect(ai.streamClassroomDialogue).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toContainEqual({ type: 'done', reply: CHILD_SAFE_REDIRECT, route: 'handoff' });
  });
  it('ordinary frozen rich-text lesson content is reviewed as text without false markup rejection', async () => {
    const { service, cockpit, ai } = setup();
    cockpit.get.mockResolvedValue({ ...state(), lesson: { ...state().lesson, currentStep: { ...state().lesson.currentStep, studentContent: '<p>观察圆形</p>' } } });
    const result = await collect(service.reply({} as never, 1, dto, new AbortController().signal));
    expect(ai.reviewClassroomContent.mock.calls[0]?.[0]).toMatchObject({ context: { studentContent: ' 观察圆形 ' } });
    expect(result).toContainEqual(expect.objectContaining({ type: 'done', route: 'question' }));
  });
  it('a phase/version change during output review invalidates all pending narration', async () => {
    const { service, ai, cockpit } = setup();
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    ai.reviewClassroomContent.mockImplementation(async input => {
      if ((input as { stage: string }).stage === 'output') { reached(); await gate; }
      return { decision: 'allow', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true };
    });
    const iterator = service.reply({} as never, 1, dto, new AbortController().signal);
    await iterator.next(); const pending = iterator.next(); await ready;
    cockpit.get.mockResolvedValue({ ...state(), phase: 'paused' }); release();
    await expect(pending).rejects.toThrow();
  });
  it('semantic reviewer SDK uses strict JSON data, cancellation, zero tools and no raw result on malformed/truncated decisions', async () => {
    const ai = new AiService({ get: (key: string) => key === 'ARK_API_KEY' ? 'synthetic-only' : key === 'ARK_ENDPOINT_ID' ? 'synthetic-model' : undefined } as ConfigService);
    const create = jest.fn(async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"decision":"allow"}' } }] }));
    const client = Reflect.get(ai, 'openai') as { chat: { completions: { create: unknown } } }; client.chat.completions.create = create;
    const signal = new AbortController().signal;
    expect(await ai.reviewClassroomContent({ ageGroup: '4-5', content: '合成问题' }, signal)).toEqual({ decision: 'allow' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: false, temperature: 0, response_format: { type: 'json_object' }, thinking: { type: 'disabled' } }), { signal });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('tools');
    create.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: '{"decision":"allow"}' } }] });
    expect(await ai.reviewClassroomContent({}, signal)).toBeNull();
  });
});
