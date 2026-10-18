import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkOutDir } from './check-out-dir.js';

describe('checkOutDir', () => {
  it('should accept the folder when it exists and can be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-'));

    expect(await checkOutDir(dir)).toBeUndefined();
  });

  it('should accept a folder that does not exist yet when its parent can be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-'));

    expect(await checkOutDir(join(dir, 'reports', '2026'))).toBeUndefined();
  });

  it('should say the path is a file and give the way out when the folder is really a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-'));
    const file = join(dir, 'afile');
    writeFileSync(file, 'x');

    const problem = await checkOutDir(file);

    expect(problem).toContain(`${file} is a file, not a folder`);
    expect(problem).toContain('config set outDir');
  });

  it('should say a path below a file is unusable when a parent is a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-'));
    const file = join(dir, 'afile');
    writeFileSync(file, 'x');

    expect(await checkOutDir(join(file, 'sub'))).toContain('is a file, not a folder');
  });

  it('should say there is no permission when the folder cannot be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-'));
    chmodSync(dir, 0o500);

    const problem = await checkOutDir(join(dir, 'x'));
    chmodSync(dir, 0o700);

    expect(problem).toContain('no permission to write');
  });

  it('should answer within a few seconds when the path is on a file system that never answers', async () => {
    const started = Date.now();

    await checkOutDir('/proc/nope');

    expect(Date.now() - started).toBeLessThan(8_000);
  });
});
