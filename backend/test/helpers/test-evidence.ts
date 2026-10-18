import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** Opt-in per-run evidence names: full regression must not overwrite historical failures. */
export async function writeTestEvidence(...args: Parameters<typeof writeFile>): Promise<void> {
  const [file, data, options] = args;
  const prefix = process.env.TEST_EVIDENCE_RUN_PREFIX;
  let target = file;
  if (prefix && typeof file === 'string' && dirname(resolve(file)) === resolve(process.cwd(), '.tmp')) {
    if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid test evidence prefix');
    target = join(dirname(file), `${prefix}-${basename(file)}`);
  }
  await writeFile(target, data, options);
}
