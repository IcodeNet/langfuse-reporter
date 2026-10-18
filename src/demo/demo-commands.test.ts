import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoNextSteps } from '../app/run-demo.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const OUT = mkdtempSync(join(tmpdir(), 'demo-cmd-'));

/** Runs the real program on the sample data, as a person would in a terminal. */
function runDemo(args: string[]): { code: number; text: string; stdout: string } {
  const run = spawnSync(TSX, ['src/index.ts', '--demo', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    input: '',
    timeout: 60_000,
  });
  return { code: run.status ?? -1, text: `${run.stdout}${run.stderr}`, stdout: run.stdout };
}

describe('jeves --demo', () => {
  it('should run a guided check and list what to try next when no command is given', () => {
    const run = runDemo([]);

    expect([
      run.code,
      run.text.includes('Every link of the chain is fine.'),
      run.text.includes('Try these next'),
    ]).toEqual([0, true, true]);
  });

  it('should say the data is sample data before anything else when no command is given', () => {
    expect(runDemo([]).text).toContain('built-in sample data');
  });

  it('should give no advice that leads to an empty window when the doctor runs on sample data', () => {
    const run = runDemo(['doctor']);

    expect([run.code, run.text.includes('[CHECK] Window')]).toEqual([0, false]);
  });

  it('should print the sample ratings as JSON when the report is asked for', () => {
    const run = runDemo(['feedback', 'report', '--format', 'json']);

    expect([run.code, (JSON.parse(run.stdout) as unknown[]).length]).toEqual([0, 60]);
  });

  it('should write the sample ratings to disk when an export is asked for', () => {
    const run = runDemo(['feedback', 'export', '--format', 'csv', '--out', join(OUT, 'csv')]);

    expect([run.code, readdirSync(join(OUT, 'csv')).length]).toEqual([0, 2]);
  });

  it('should write a themes workbook when analyse runs without a model', () => {
    const run = runDemo(['analyse', '--out', join(OUT, 'themes')]);

    expect([
      run.code,
      existsSync(join(OUT, 'themes')),
      readdirSync(join(OUT, 'themes'))[0]?.endsWith('.xlsx'),
    ]).toEqual([0, true, true]);
  });

  it('should explain in plain words that a command needs the config file when it cannot run on sample data', () => {
    const run = runDemo(['config', 'check']);

    expect([run.code, run.text.includes('not available with --demo')]).toEqual([2, true]);
  });

  it.each(demoNextSteps('jeves').map(([command]) => [command] as const))(
    'should list a next step that is a real command when the step is %s',
    (command) => {
      const words = command.split(' ').slice(1);

      expect(words[0]).toBe('--demo');
    },
  );

  it('should print the themes, the counts and an existing file as JSON when analyse is given --json', () => {
    const run = runDemo(['analyse', '--json', '--out', join(OUT, 'analyse-json')]);

    const outcome = JSON.parse(run.stdout) as {
      ratings: number;
      themes: Array<{ count: number }>;
      unplaced: number;
      file: string;
    };
    const placed = outcome.themes.reduce((sum, theme) => sum + theme.count, 0);
    expect([
      run.code,
      outcome.ratings,
      placed + outcome.unplaced,
      existsSync(outcome.file),
    ]).toEqual([0, 60, 60, true]);
  });
});
