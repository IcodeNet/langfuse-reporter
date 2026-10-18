import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { startGoldenLangfuse, type GoldenLangfuse } from './golden-langfuse.js';

/**
 * The two example pipelines are run as written: each `jeves` step is taken from the example file,
 * with the weekly window swapped for the golden data's window, and run in a clean environment with no
 * config file, as a pipeline would.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const EXAMPLES = [
  'examples/github-actions/weekly-feedback.yml',
  'examples/azure-devops/feedback-weekly.yml',
];

let golden: GoldenLangfuse;
let work: string;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  golden = await startGoldenLangfuse();
  work = mkdtempSync(join(tmpdir(), 'pipeline-'));
  const bin = join(work, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'jeves'),
    `#!/bin/sh\nexec ${join(ROOT, 'node_modules/.bin/tsx')} ${join(ROOT, 'src/index.ts')} "$@"\n`,
  );
  chmodSync(join(bin, 'jeves'), 0o755);
  env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: join(work, 'home'),
    NO_COLOR: '1',
    CI: 'true',
    LANGFUSE_BASE_URL: golden.url,
    LANGFUSE_PUBLIC_KEY: 'pk-ci',
    LANGFUSE_SECRET_KEY: 'sk-ci',
  };
});

afterAll(async () => {
  await golden.close();
});

function runShell(
  script: string,
  folder: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-eo', 'pipefail', '-c', script], {
      cwd: folder,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** The shell text of each step that runs jeves, with the weekly window replaced by the golden window. */
function jevesSteps(file: string): string[] {
  const parsed = parse(readFileSync(join(ROOT, file), 'utf8')) as {
    jobs?: Record<string, { steps: Array<{ run?: string }> }>;
    steps?: Array<{ script?: string }>;
  };
  const steps = [
    ...Object.values(parsed.jobs ?? {}).flatMap((job) => job.steps.map((step) => step.run)),
    ...(parsed.steps ?? []).map((step) => step.script),
  ];
  return steps
    .filter((step): step is string => typeof step === 'string' && step.includes('jeves '))
    .filter((step) => !step.includes('npm install'))
    .map((step) =>
      step.replace(/--from "[^"]*" --to "[^"]*"/, '--from 2026-09-01 --to 2026-10-01'),
    );
}

describe.each(EXAMPLES)('example pipeline %s', (file) => {
  it('should contain a doctor step and an export step that uses the JSON output', () => {
    const steps = jevesSteps(file).join('\n');

    expect([
      steps.includes('jeves doctor --json'),
      steps.includes('--json'),
      steps.includes('--fail-if-empty'),
    ]).toEqual([true, true, true]);
  });

  it('should pass every jeves step with no config file and write the report files named in the JSON', async () => {
    const folder = mkdtempSync(join(work, 'run-'));
    const results = [];
    for (const step of jevesSteps(file)) results.push((await runShell(step, folder)).code);

    const exported = JSON.parse(readFileSync(join(folder, 'export.json'), 'utf8')) as {
      selected: number;
      files: Array<{ path: string }>;
    };
    expect([
      results,
      exported.selected,
      exported.files.every((each) => existsSync(each.path)),
      readdirSync(join(folder, 'reports')).length,
    ]).toEqual([results.map(() => 0), 5, true, 2]);
  });

  it('should stop the pipeline with exit code 3 when the window holds no ratings', async () => {
    const folder = mkdtempSync(join(work, 'empty-'));
    const empty = jevesSteps(file).map((step) =>
      step.replace('--from 2026-09-01 --to 2026-10-01', '--from 2025-01-01 --to 2025-02-01'),
    );
    const codes = [];
    for (const step of empty) codes.push((await runShell(step, folder)).code);

    expect(codes.at(-1)).toBe(3);
  });
});
