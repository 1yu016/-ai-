import { effectScope, reactive } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useClassroomDialogue } from '@/composables/useClassroomDialogue'
import { streamClassroomDialogue } from '@/services/classroomDialogue'
import { ReadableStream } from 'node:stream/web'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.unstubAllGlobals() })
function setup(transport: ReturnType<typeof vi.fn<typeof streamClassroomDialogue>> = vi.fn<typeof streamClassroomDialogue>(async () => ({ reply: '圆形可以滚动。', route: 'question' }))) {
  const state = reactive({ identity: 'run1:step0', allowed: true }), complete = vi.fn(), stop = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const dialogue = scope.run(() => useClassroomDialogue({ identity: () => state.identity, allowed: () => state.allowed, runId: () => 1, stepIndex: () => 0, token: () => 'synthetic', onComplete: complete, onStop: stop }, transport))!
  return { state, dialogue, complete, stop, transport, scope }
}
it('keeps a bounded multi-turn context and performs one request per question', async () => {
  const { dialogue, transport } = setup()
  await dialogue.ask('为什么圆形会滚？'); await dialogue.ask('还可以讲个故事吗？')
  expect(transport).toHaveBeenCalledTimes(2)
  expect(transport.mock.calls[1]?.[0]).toMatchObject({ history: [{ role: 'user', content: '为什么圆形会滚？' }, { role: 'assistant', content: '圆形可以滚动。' }] })
})
it.each(['pause', 'step', 'dispose'])('invalidates late chunks/completion on %s without auto retry', async kind => {
  let release!: (result: { reply: string; route: string }) => void
  const transport = vi.fn<typeof streamClassroomDialogue>(() => new Promise<{ reply: string; route: string }>(resolve => { release = resolve }))
  const { dialogue, state, complete, scope } = setup(transport)
  const request = dialogue.ask('为什么下雨？')
  const input = transport.mock.calls[0]?.[0] as unknown as { signal: AbortSignal }
  if (kind === 'pause') state.allowed = false
  else if (kind === 'step') state.identity = 'run1:step1'
  else scope.stop()
  expect(input.signal.aborted).toBe(true)
  release({ reply: '旧回答', route: 'question' }); await request
  expect(complete).not.toHaveBeenCalled(); expect(dialogue.reply.value).toBe('')
  if (kind === 'pause') state.allowed = true
  expect(transport).toHaveBeenCalledTimes(1)
})
it('preserves partial text but never speaks a failed stream or retries it', async () => {
  const transport = vi.fn<typeof streamClassroomDialogue>(async (_input, update) => { update('未完成文字'); throw new Error('network interrupted') })
  const { dialogue, complete } = setup(transport)
  await dialogue.ask('什么是圆形？')
  expect(dialogue.reply.value).toBe('未完成文字'); expect(dialogue.error.value).toContain('network')
  expect(complete).not.toHaveBeenCalled(); expect(dialogue.history.value).toEqual([])
  expect(transport).toHaveBeenCalledTimes(1)
})
it('does not retain/voice a handoff or teacher operation as child conversation', async () => {
  const { dialogue, complete } = setup(vi.fn(async () => ({ reply: '请老师操作', route: 'teacher_intent' })))
  await dialogue.ask('奖励小朋友')
  expect(dialogue.history.value).toEqual([]); expect(complete).not.toHaveBeenCalled()
})
function response(events: unknown[], finalNewline = true) {
  const text = events.map(event => JSON.stringify(event)).join('\n') + (finalNewline ? '\n' : '')
  const stream = new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } })
  return new Response(stream as unknown as BodyInit, { headers: { 'Content-Type': 'application/x-ndjson' } })
}
const input = () => ({ runId: 1, stepIndex: 0, requestId: 'id', text: '为什么？', history: [], token: 'synthetic', signal: new AbortController().signal })
const meta = { type: 'meta', safetyContractVersion: 1, requestId: 'id', runId: 1, stepIndex: 0, route: 'question' }
const safety = { contractVersion: 1, status: 'approved', scope: 'whole_reply' }
it('parses real NDJSON framing, multibyte boundaries and completed result', async () => {
  const fetcher = vi.fn(async () => response([meta, { type: 'delta', text: '你好。', safety }, { type: 'done', reply: '你好。' }], false)); vi.stubGlobal('fetch', fetcher)
  const update = vi.fn()
  expect(await streamClassroomDialogue(input(), update)).toEqual({ reply: '你好。', route: 'question' })
  expect(update).toHaveBeenCalledWith('你好。'); expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each([undefined, { ...safety, scope: 'sentence' }, { ...safety, status: 'pending' }])('does not expose unchecked model text to the speech callback (%j)', async safety => {
  vi.stubGlobal('fetch', vi.fn(async () => response([meta, { type: 'delta', text: '未经检查', safety }, { type: 'done', reply: '未经检查' }])))
  const speak = vi.fn(); await expect(streamClassroomDialogue(input(), speak)).rejects.toThrow('安全检查')
  expect(speak).not.toHaveBeenCalled()
})
it('approved fixed handoff is not retained as an ordinary child conversation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response([meta, { type: 'delta', text: '请老师陪我们。', safety }, { type: 'done', reply: '请老师陪我们。', route: 'handoff' }])))
  expect(await streamClassroomDialogue(input(), vi.fn())).toEqual({ reply: '请老师陪我们。', route: 'handoff' })
})
it.each(['mismatch', 'truncated', 'error'])('rejects %s stream without retry', async kind => {
  const events = kind === 'mismatch' ? [{ ...meta, runId: 9 }] : kind === 'truncated' ? [meta, { type: 'delta', text: '部分' }] : [meta, { type: 'error', message: 'context changed' }]
  const fetcher = vi.fn(async () => response(events)); vi.stubGlobal('fetch', fetcher)
  await expect(streamClassroomDialogue(input(), vi.fn())).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1)
})
