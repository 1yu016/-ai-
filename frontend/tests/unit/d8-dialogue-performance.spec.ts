import { afterEach, expect, it, vi } from 'vitest'
import { streamClassroomDialogue } from '@/services/classroomDialogue'

afterEach(() => vi.unstubAllGlobals())
it('records request-correlated non-content timing only after strict approval, without extra requests', async () => {
  const events: unknown[] = []
  const listener = (event: Event) => events.push((event as CustomEvent).detail)
  window.addEventListener('classroom-dialogue-performance', listener)
  try {
    const frames = [
      { type: 'meta', requestId: 'd8', runId: 1, stepIndex: 0, route: 'question', safetyContractVersion: 1 },
      { type: 'delta', text: '圆形会滚。', safety: { contractVersion: 1, status: 'approved', scope: 'whole_reply' } },
      { type: 'done', reply: '圆形会滚。', performance: { generationMs: 123, outputReviewMs: 456, secret: 'never', totalMs: -1 } },
    ]
    const fetcher = vi.fn(async () => new Response(frames.map(frame => JSON.stringify(frame)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    vi.stubGlobal('fetch', fetcher)
    await streamClassroomDialogue({ requestId: 'd8', runId: 1, stepIndex: 0, text: '合成问题', history: [], token: 'synthetic-secret', signal: new AbortController().signal }, vi.fn())
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(expect.objectContaining({ stage: 'server:generationMs', durationMs: 123, requestId: 'd8' }))
    expect(events).toContainEqual(expect.objectContaining({ stage: 'first-approved-text' }))
    expect(JSON.stringify(events)).not.toMatch(/合成问题|圆形|synthetic-secret|never/)
    expect(events).not.toContainEqual(expect.objectContaining({ stage: 'server:totalMs' }))
  } finally { window.removeEventListener('classroom-dialogue-performance', listener) }
})
