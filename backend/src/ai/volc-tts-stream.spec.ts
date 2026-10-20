import { jest } from '@jest/globals';
import { readVolcTtsStream } from './volc-tts-stream';

describe('D9 complete-synthesis stream adapter', () => {
  it('returns the same complete audio on terminal frame without waiting for connection EOF', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n')); }, cancel });
    await expect(readVolcTtsStream(new Response(body))).resolves.toEqual(Buffer.from('ID3'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['data: {"code":0,"data":"SUQz"}\n', 'data: {"code":0,"data":"SUQz"}\ndata: {"code":500,"data":null}\n', 'data: {broken}\n', 'data: {"code":20000000}\n'])('rejects truncated/failed/malformed/empty synthesis rather than returning partial audio', async text => {
    await expect(readVolcTtsStream(new Response(text))).rejects.toThrow();
  });
  it('aborts a blocked read and releases its reader, without replay', async () => {
    const abort = new AbortController(), cancel = jest.fn();
    const task = readVolcTtsStream(new Response(new ReadableStream({ cancel })), abort.signal);
    abort.abort(); await expect(task).rejects.toThrow(); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('accepts UTF8/SSE framing split at arbitrary byte boundaries in original order', async () => {
    const bytes = new TextEncoder().encode('event: 352\r\ndata: {"code":0,"data":"SUQz"}\r\n\r\ndata: {"code":0,"data":"YWJj"}\ndata: {"code":20000000}');
    const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    await expect(readVolcTtsStream(new Response(stream))).resolves.toEqual(Buffer.from('ID3abc'));
  });
});
