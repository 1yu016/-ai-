import type { DataSource } from 'typeorm';

// SQLite shares one QueryRunner per DataSource. Acquire this existing FIFO
// before opening a transaction, never from inside an acquired transaction.
const writeTails = new WeakMap<DataSource, Promise<void>>();

export async function serializeDatabaseWrite<T>(source: DataSource, work: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(source) ?? Promise.resolve();
  let release!: () => void;
  writeTails.set(source, new Promise<void>(resolve => { release = resolve; }));
  await previous;
  try { return await work(); }
  finally { release(); }
}
