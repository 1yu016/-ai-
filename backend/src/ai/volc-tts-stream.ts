/** Complete synthesis only; never interprets first audio as successful completion. */
export async function readVolcTtsStream(response: Response, signal?: AbortSignal, observe?: (stage: string, elapsedMs: number) => void): Promise<Buffer> {
  if (!response.ok || !response.body) throw Error('TTS_UPSTREAM_UNAVAILABLE');
  const reader = response.body.getReader(), decoder = new TextDecoder(), chunks: Buffer[] = [];
  const started = performance.now();
  let pending = '', finished = false, size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const line = (raw: string) => {
    if (!raw.startsWith('data:')) return;
    const value = raw.slice(5).trim();
    if (!value || value === '[DONE]') return;
    const frame: { code?: number; data?: unknown } = JSON.parse(value);
    if (frame.code !== 0 && frame.code !== 20000000) throw Error('TTS_PROVIDER_REJECTED');
    if (typeof frame.data === 'string' && frame.data) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw Error('TTS_INVALID_AUDIO');
      const audio = Buffer.from(frame.data, 'base64');
      if (!chunks.length) observe?.('firstAudioMs', performance.now() - started);
      size += audio.length;
      if (size > 20 * 1024 * 1024) throw Error('TTS_AUDIO_LIMIT');
      chunks.push(audio);
    }
    if (frame.code === 20000000) { finished = true; observe?.('terminalMs', performance.now() - started); }
  };
  try {
    while (!finished) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      pending += decoder.decode(part.value, { stream: !part.done });
      if (pending.length > 2 * 1024 * 1024) throw Error('TTS_FRAME_LIMIT');
      let boundary: number;
      while (!finished && (boundary = pending.indexOf('\n')) >= 0) { const raw = pending.slice(0, boundary).replace(/\r$/, ''); pending = pending.slice(boundary + 1); line(raw); }
      if (part.done) { if (!finished && pending.trim()) line(pending.trim()); break; }
    }
    if (!finished || !chunks.length) throw Error('TTS_INCOMPLETE_SYNTHESIS');
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
