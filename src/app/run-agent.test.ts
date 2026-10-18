import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { agentProcedure } from './run-agent.js';

const ROOT = new URL('../../', import.meta.url).pathname;

describe('jeves agent', () => {
  it('should hold the rules that never bend and the numbered steps when the procedure is read', async () => {
    const text = await agentProcedure();

    expect([
      text.includes('Never open, print, read aloud or paste the contents of an env file'),
      text.includes('Never turn masking off'),
      text.includes('## Step 1: try it on sample data'),
      text.includes('## Step 4: use it in a pipeline'),
    ]).toEqual([true, true, true, true]);
  });

  it('should print the procedure on stdout and nothing on stderr when the command runs', () => {
    const run = spawnSync(`${ROOT}node_modules/.bin/tsx`, ['src/index.ts', 'agent'], {
      cwd: ROOT,
      encoding: 'utf8',
      input: '',
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: '1' },
    });

    expect([
      run.status,
      run.stdout.includes('Set up and use Jeves for a team'),
      run.stderr,
    ]).toEqual([0, true, '']);
  });
});
