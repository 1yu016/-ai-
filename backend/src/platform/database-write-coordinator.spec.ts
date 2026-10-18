import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { serializeDatabaseWrite } from './database-write-coordinator';

describe('shared DataSource write FIFO', () => {
  it('serializes different callers until the prior work has finished', async () => {
    const source = {} as DataSource;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const first = serializeDatabaseWrite(source, async () => { entered(); await gate; return 'first'; });
    await ready;
    const work = jest.fn(async () => 'second');
    const second = serializeDatabaseWrite(source, work);
    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
    release();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('releases the queue on failure without swallowing the original error', async () => {
    const source = {} as DataSource;
    const failure = new Error('first write failed');
    await expect(serializeDatabaseWrite(source, async () => { throw failure; })).rejects.toBe(failure);
    expect(await serializeDatabaseWrite(source, async () => 'next')).toBe('next');
  });

  it('does not serialize unrelated DataSources', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const blocked = serializeDatabaseWrite({} as DataSource, async () => { await gate; });
    try { expect(await serializeDatabaseWrite({} as DataSource, async () => 'independent')).toBe('independent'); }
    finally { release(); await blocked; }
  });
});
