import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;

function runDemo(args: string[]): { code: number; stdout: string; stderr: string } {
  const home = mkdtempSync(join(tmpdir(), 'doc-facts-'));
  const done = spawnSync(
    join(ROOT, 'node_modules/.bin/tsx'),
    [join(ROOT, 'src/index.ts'), '--demo', ...args],
    {
      env: { PATH: process.env.PATH, HOME: home, NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { code: done.status ?? -1, stdout: done.stdout, stderr: done.stderr };
}

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

describe('facts the README states about the sample data', () => {
  it('should find the 60 ratings on 60 traces the README quotes when a demo export counts them', () => {
    const run = runDemo(['feedback', 'export', '--dry-run']);

    expect(run.stderr + run.stdout).toContain('Found 60 ratings on 60 traces');
    expect(readme).toContain('Found 60 ratings on 60 traces');
  });

  it('should count 33 positive and 27 negative ratings when the demo export prints JSON', () => {
    const run = runDemo(['feedback', 'export', '--dry-run', '--json']);

    expect(JSON.parse(run.stdout)).toMatchObject({ found: 60, positive: 33, negative: 27 });
  });

  it('should exit with 1 when the demo saved queries run, as the README says on purpose', () => {
    const run = runDemo(['query', 'run', '--all']);

    expect(run.code).toBe(1);
    expect(readme).toContain('exit code 1 on purpose');
  });

  it('should exit with 3 when --fail-if-empty finds no thumbs-down, as the README says', () => {
    const run = runDemo([
      'feedback',
      'export',
      '--dry-run',
      '--where',
      'comment = "no-such-text-xyz"',
      '--fail-if-empty',
    ]);

    expect(run.code).toBe(3);
    expect(readme).toContain('`--fail-if-empty` exits 3');
  });
});
