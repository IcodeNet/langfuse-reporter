import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startChaosLangfuse, type ChaosLangfuse, type Fault } from './chaos-langfuse.js';
import { startGoldenLangfuse, type GoldenLangfuse } from './golden-langfuse.js';

/**
 * Chaos: a Langfuse that misbehaves in every way a real one can. For each fault the tool must stop
 * quickly, exit with 1, and say in plain words what is wrong and what to try next. It must never hang,
 * never print a raw parser message, and never call a broken reply a success.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const FROM = '2026-09-01';
const TO = '2026-10-01';

let golden: GoldenLangfuse;
let work: string;
const open: ChaosLangfuse[] = [];

beforeAll(async () => {
  golden = await startGoldenLangfuse();
  work = mkdtempSync(join(tmpdir(), 'chaos-'));
  writeFileSync(
    join(work, 'keys.env'),
    'LANGFUSE_PUBLIC_KEY=pk-chaos\nLANGFUSE_SECRET_KEY=sk-chaos-SECRETMARK\n',
  );
});

afterAll(async () => {
  await Promise.all(open.map((each) => each.close()));
  await golden.close();
});

async function run(
  address: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const config = join(work, `config-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(
    config,
    JSON.stringify({
      activeProfile: 'dev',
      outDir: join(work, 'out'),
      profiles: { dev: { baseUrl: address, envFile: join(work, 'keys.env') } },
    }),
  );
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(
      TSX,
      [join(ROOT, 'src/index.ts'), '--config', config, ...args],
      {
        cwd: work,
        env: { ...process.env, NO_COLOR: '1', HOME: work },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`jeves ${args.join(' ')} hung`));
    }, 15_000);
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function withFault(
  fault: Fault,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const chaos = await startChaosLangfuse({ upstream: golden.url, fault });
  open.push(chaos);
  return run(chaos.url, args);
}

const EXPORT = ['feedback', 'export', '--dry-run', '--from', FROM, '--to', TO];

const EXPECTED: Array<[Fault, string, string]> = [
  ['unauthorized', 'answered 401', 'Check LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY'],
  ['forbidden', 'answered 403', 'Use a key pair created for this project'],
  ['not-found', 'answered 404', 'with no path after it'],
  ['html', 'not data', 'The address may point at a web page'],
  ['truncated-json', 'not data', 'The address may point at a web page'],
  ['empty-body', 'not data', 'The address may point at a web page'],
  [
    'wrong-shape',
    'a shape the tool does not know',
    'report this message with the Langfuse version',
  ],
  ['reset', 'Could not connect', 'Check the address'],
  ['endless-cursor', 'sent the same page marker again', 'Choose a shorter window'],
];

describe.each(EXPECTED)(
  'when Langfuse answers with the fault %s',
  { timeout: 30_000 },
  (fault, said, advice) => {
    it('should exit with 1 and name what happened and what to try next', async () => {
      const run1 = await withFault(fault, EXPORT);

      const lastLine = run1.stderr.trim().split('\n').at(-1) ?? '';
      expect([run1.code, lastLine.includes(said), lastLine.includes(advice)]).toEqual([
        1,
        true,
        true,
      ]);
    });

    it('should print nothing on stdout when the JSON output was asked for', async () => {
      const run2 = await withFault(fault, [...EXPORT, '--json']);

      expect([run2.code, run2.stdout]).toEqual([1, '']);
    });

    it('should never show a raw parser message or a stack trace', async () => {
      const run3 = await withFault(fault, EXPORT);

      expect(/Unexpected token|Unexpected end of JSON|SyntaxError|    at /.test(run3.stderr)).toBe(
        false,
      );
    });

    it('should never print a key', async () => {
      const run4 = await withFault(fault, EXPORT);

      expect(`${run4.stdout}${run4.stderr}`.includes('SECRETMARK')).toBe(false);
    });
  },
);

describe('when Langfuse is busy or down', { timeout: 30_000 }, () => {
  it('should retry and then say Langfuse is limiting how fast it answers when it answers 429 every time', async () => {
    const result = await withFault('too-many', EXPORT);

    expect([
      result.code,
      result.stderr.includes('retry 6'),
      result.stderr.trim().split('\n').at(-1)?.includes('Wait a minute'),
    ]).toEqual([1, true, true]);
  });

  it('should carry on and finish when the first two requests fail and the rest work', async () => {
    const chaos = await startChaosLangfuse({
      upstream: golden.url,
      fault: 'server-error',
      failFirst: 2,
    });
    open.push(chaos);

    const result = await run(chaos.url, EXPORT);

    expect([
      result.code,
      result.stderr.includes('6 of 6 ratings selected'),
      result.stderr.includes('retry 1'),
    ]).toEqual([0, true, true]);
  });

  it('should tell the user at the first retry how many more will follow and how to stop', async () => {
    const chaos = await startChaosLangfuse({
      upstream: golden.url,
      fault: 'server-error',
      failFirst: 1,
    });
    open.push(chaos);

    const result = await run(chaos.url, EXPORT);

    expect(result.stderr).toContain(
      'it will try up to 6 more times, about a minute in all; press Ctrl+C to stop',
    );
  });
});

describe('when the address is not a Langfuse at all', { timeout: 30_000 }, () => {
  it('should say it could not connect and what to check when nothing listens on the port', async () => {
    const result = await run('http://127.0.0.1:1', EXPORT);

    expect([
      result.code,
      result.stderr.trim().split('\n').at(-1)?.includes('Could not connect to http://127.0.0.1:1'),
    ]).toEqual([1, true]);
  });

  it('should fail the project check in doctor with the same fix text when the keys are refused', async () => {
    const result = await withFault('unauthorized', ['doctor', '--json']);

    const project = (
      JSON.parse(result.stdout) as {
        checks: Array<{ label: string; status: string; fix?: string }>;
      }
    ).checks.find((each) => each.label === 'Project');
    expect([
      result.code,
      project?.status,
      project?.fix?.includes('Check LANGFUSE_PUBLIC_KEY'),
    ]).toEqual([1, 'fail', true]);
  });
});
