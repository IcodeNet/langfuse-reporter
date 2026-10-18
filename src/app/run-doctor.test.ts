import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LangfuseScore, LangfuseTurn } from '../langfuse/langfuse-client.js';
import type { Reporter } from '../ui/reporter.js';
import { collectChecks, type DoctorClient } from './run-doctor.js';

const NOW = new Date('2026-10-14T10:00:00.000Z');

const REPORTER: Reporter = {
  task: () => ({ update: () => undefined, succeed: () => undefined, fail: () => undefined }),
  done: () => undefined,
  info: () => undefined,
  note: () => undefined,
  styled: () => undefined,
  document: () => undefined,
  warn: () => undefined,
  block: () => undefined,
  section: (_title, body) => Promise.resolve(body()),
  cancel: () => undefined,
};

function turnScore(): LangfuseScore {
  return { subject: { kind: 'observation', id: 'o1', traceId: 't1' } } as LangfuseScore;
}

function traceScore(): LangfuseScore {
  return { subject: { kind: 'trace', id: 't1' } } as LangfuseScore;
}

/** A turn the rating of `turnScore()` was given on, as Langfuse returns it. */
const RATED_TURN = { id: 'o1', traceId: 't1' } as LangfuseTurn;

function fakeClient(
  scores: LangfuseScore[],
  projectName = 'acme-development',
  turns: LangfuseTurn[] = [RATED_TURN],
): DoctorClient {
  return {
    getProject: () => Promise.resolve({ id: 'p1', name: projectName }),
    listScores: () => Promise.resolve(scores),
    getTurns: () => Promise.resolve(turns),
  };
}

/** Answers differently for the old default window and the recent week, as a real project can. */
function clientWithOldAndRecent(old: LangfuseScore[], recent: LangfuseScore[]): DoctorClient {
  return {
    getProject: () => Promise.resolve({ id: 'p1', name: 'acme-development' }),
    listScores: ({ from }) => Promise.resolve(from.startsWith('2026-10-07') ? recent : old),
    getTurns: () => Promise.resolve([RATED_TURN]),
  };
}

/** Writes a config and an env file in a scratch folder and returns the config path. */
function setup(options: { withKeys?: boolean; envFile?: string; profile?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'));
  const envPath = join(dir, 'dev.env');
  if (options.withKeys !== false) {
    writeFileSync(envPath, 'LANGFUSE_PUBLIC_KEY=pk-lf-1\nLANGFUSE_SECRET_KEY=sk-lf-1\n');
  } else {
    writeFileSync(envPath, 'OTHER=1\n');
  }
  const envFile = options.envFile ?? envPath;
  const profile = options.profile ?? 'dev';
  const config = {
    activeProfile: profile,
    outDir: dir,
    profiles: {
      [profile]: { baseUrl: 'https://cloud.langfuse.com', ...(envFile ? { envFile } : {}) },
    },
  };
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config));
  return path;
}

async function run(configPath: string, client: DoctorClient = fakeClient([turnScore()])) {
  const checks = await collectChecks({
    configPath,
    profileOverride: undefined,
    reporter: REPORTER,
    now: NOW,
    createClient: () => client,
  });
  return Object.fromEntries(checks.map((check) => [check.label, check]));
}

describe('collectChecks', () => {
  it('should find every link fine when keys, project and a turn-level rating all exist', async () => {
    const byLabel = await run(setup());

    expect(
      ['Config file', 'Profile', 'Env file', 'Keys', 'Output folder', 'Project', 'Ratings'].map(
        (label) => [label, byLabel[label]?.status],
      ),
    ).toEqual([
      ['Config file', 'ok'],
      ['Profile', 'ok'],
      ['Env file', 'ok'],
      ['Keys', 'ok'],
      ['Output folder', 'ok'],
      ['Project', 'ok'],
      ['Ratings', 'ok'],
    ]);
  });

  it('should fail the env file with the command that sets it when the file cannot be read', async () => {
    const byLabel = await run(setup({ envFile: '/nonexistent/dev.env' }));

    expect([byLabel['Env file']?.status, byLabel['Env file']?.fix]).toEqual([
      'fail',
      'jeves --profile dev config set profile.envFile <absolute-path>',
    ]);
  });

  it('should name the missing key and skip project and ratings when the env file has no keys', async () => {
    const byLabel = await run(setup({ withKeys: false }));

    expect([
      byLabel['Keys']?.status,
      byLabel['Keys']?.detail.includes('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY not found'),
      byLabel['Project']?.status,
      byLabel['Ratings']?.status,
    ]).toEqual(['fail', true, 'skip', 'skip']);
  });

  it('should fail the project with a way to look at the config when Langfuse refuses the keys', async () => {
    const refusing: DoctorClient = {
      getProject: () =>
        Promise.reject(new Error('Langfuse /api/public/projects failed: 401 Unauthorized')),
      listScores: () => Promise.resolve([]),
      getTurns: () => Promise.resolve([]),
    };

    const byLabel = await run(setup(), refusing);

    expect([
      byLabel['Project']?.status,
      byLabel['Project']?.detail,
      byLabel['Ratings']?.status,
    ]).toEqual([
      'fail',
      'Langfuse at https://cloud.langfuse.com refused these keys: Langfuse /api/public/projects failed: 401 Unauthorized',
      'skip',
    ]);
  });

  it('should flag production in the project line when the project is named production', async () => {
    const byLabel = await run(setup(), fakeClient([turnScore()], 'acme-production'));

    expect([byLabel['Project']?.status, byLabel['Project']?.detail]).toEqual([
      'warn',
      'acme-production is PRODUCTION: real customer conversations',
    ]);
  });

  it('should explain that ratings sit on the trace when none are on a chat turn', async () => {
    const byLabel = await run(setup(), fakeClient([traceScore(), traceScore()]));

    expect([byLabel['Ratings']?.status, byLabel['Ratings']?.detail]).toEqual([
      'fail',
      '2 found, but all sit on the whole trace, not on a chat turn, so the CLI cannot place them',
    ]);
  });

  it('should suggest a recent window when no ratings exist in the default window', async () => {
    const byLabel = await run(setup(), fakeClient([]));

    expect([byLabel['Ratings']?.status, byLabel['Ratings']?.fix]).toEqual([
      'warn',
      'try a recent window: jeves feedback export --dry-run --from 2026-10-07 --to 2026-10-15  (or check conventions.ratingScore in config show)',
    ]);
  });

  it('should warn that the window is the default when the default window has no ratings but the last week has', async () => {
    const byLabel = await run(setup());

    expect([byLabel['Window']?.status, byLabel['Window']?.fix]).toEqual([
      'warn',
      'jeves feedback export --dry-run --from 2026-10-07 --to 2026-10-15',
    ]);
  });

  it('should say the model is not set up and skip it when no model is configured', async () => {
    const byLabel = await run(setup());

    expect(byLabel['Model']?.status).toBe('skip');
  });

  it('should fail the profile and stop when the profile does not exist', async () => {
    const path = setup();
    const checks = await collectChecks({
      configPath: path,
      profileOverride: 'ghost',
      reporter: REPORTER,
      now: NOW,
      createClient: () => fakeClient([]),
    });

    expect(checks.map((check) => [check.label, check.status])).toEqual([
      ['Config file', 'ok'],
      ['Profile', 'fail'],
    ]);
  });

  it('should fail the config file and stop when the file has a wrong value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, '{"activeProfile":"dev","profiles":{"dev":{"baseUrl":"nope"}}}');

    const checks = await collectChecks({
      configPath: path,
      profileOverride: undefined,
      reporter: REPORTER,
      now: NOW,
      createClient: () => fakeClient([]),
    });

    expect([checks.length, checks[0]?.status, checks[0]?.fix]).toEqual([
      1,
      'fail',
      'jeves config check',
    ]);
  });

  it('should say the window is just old when the default window has only trace ratings but the last week has turn ratings', async () => {
    const client = clientWithOldAndRecent([traceScore()], [turnScore(), turnScore()]);

    const byLabel = await run(setup(), client);

    expect([byLabel['Ratings']?.status, byLabel['Ratings']?.detail]).toEqual([
      'warn',
      'none on a chat turn in 2026-09-01 → 2026-10-01, but 2 in the last 7 days: the setup works, the window is just old',
    ]);
  });

  it('should still fail when neither the default window nor the last week has a turn rating', async () => {
    const client = clientWithOldAndRecent([traceScore()], []);

    const byLabel = await run(setup(), client);

    expect(byLabel['Ratings']?.status).toBe('fail');
  });

  it('should fail and name the turn setting when the rated answer cannot be read back', async () => {
    const byLabel = await run(setup(), fakeClient([turnScore()], 'acme-development', []));

    expect([byLabel['Ratings']?.status, byLabel['Ratings']?.detail]).toEqual([
      'fail',
      'ratings were found, but the answer they were given on is not a "chat-turn" observation, so a real run would leave every one out',
    ]);
  });

  it('should fail the same way when the only ratings are in the recent week', async () => {
    const client = {
      ...clientWithOldAndRecent([], [turnScore()]),
      getTurns: () => Promise.resolve([]),
    };

    const byLabel = await run(setup(), client);

    expect(byLabel['Ratings']?.status).toBe('fail');
  });

  it('should stay ok when the rated answer is among the turns of its trace', async () => {
    const byLabel = await run(setup(), fakeClient([turnScore()]));

    expect(byLabel['Ratings']?.status).toBe('ok');
  });
});
