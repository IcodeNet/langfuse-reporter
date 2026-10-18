import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSmallTextFile, readSmallTextFileSync } from './safe-read.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'safe-read-'));
}

describe('readSmallTextFile', () => {
  it('should return the contents when the path is a small regular file', async () => {
    const path = join(makeDir(), 'a.env');
    writeFileSync(path, 'LANGFUSE_PUBLIC_KEY=pk');

    expect(await readSmallTextFile(path)).toBe('LANGFUSE_PUBLIC_KEY=pk');
  });

  it('should refuse the path when it is a directory', async () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'sub'));

    await expect(readSmallTextFile(join(dir, 'sub'))).rejects.toThrow('is not a regular file');
  });

  it('should refuse the path when the file is larger than a config file can be', async () => {
    const path = join(makeDir(), 'big.env');
    writeFileSync(path, 'x'.repeat(1024 * 1024 + 1));

    await expect(readSmallTextFile(path)).rejects.toThrow('too large to be a config file');
  });

  it('should keep the not-found code when the file is missing', async () => {
    await expect(readSmallTextFile(join(makeDir(), 'missing.env'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('readSmallTextFileSync', () => {
  it('should refuse the path when it is a directory', () => {
    expect(() => readSmallTextFileSync(makeDir())).toThrow('is not a regular file');
  });

  it('should refuse the path when the file is larger than a config file can be', () => {
    const path = join(makeDir(), 'big.env');
    writeFileSync(path, 'x'.repeat(1024 * 1024 + 1));

    expect(() => readSmallTextFileSync(path)).toThrow('too large to be a config file');
  });
});

/** Creates a named pipe with the platform's own tool; unavailable on Windows, where the tests skip. */
function makePipe(path: string): void {
  const result = spawnSync('mkfifo', [path]);
  if (result.status !== 0) throw new Error(`mkfifo failed for ${path}`);
}

describe('named pipes', () => {
  it.skipIf(process.platform === 'win32')(
    'should refuse the path at once when it is a named pipe nobody writes to',
    async () => {
      const path = join(makeDir(), 'pipe.env');
      makePipe(path);

      await expect(readSmallTextFile(path)).rejects.toThrow('is not a regular file');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'should refuse the path at once when it is a named pipe and the read is synchronous',
    () => {
      const path = join(makeDir(), 'pipe.env');
      makePipe(path);

      expect(() => readSmallTextFileSync(path)).toThrow('is not a regular file');
    },
  );
});
