import { describe, expect, it } from 'vitest';
import { makeMockResolvedConfig } from '../config/__mocks__/makeMockResolvedConfig.mock.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { Reporter } from '../ui/reporter.js';
import { canCountWithoutConversations, loadDataset } from './load-dataset.js';

interface FakeTurn {
  id: string;
  traceId: string;
  sessionId: string;
  name: 'chat-turn';
  startTime: string;
  environment: string;
  userId: string;
  input: string;
  output: string;
}

interface TurnSpec {
  id: string;
  traceId: string;
  sessionId: string;
  minute: number;
}

function makeTurn({ id, traceId, sessionId, minute }: TurnSpec): FakeTurn {
  return {
    id,
    traceId,
    sessionId,
    name: 'chat-turn',
    startTime: `2026-09-10T10:0${minute}:00.000Z`,
    environment: 'production',
    userId: 'U-1',
    input: `question ${id}`,
    output: `answer ${id}`,
  };
}

interface ScoreSpec {
  name: string;
  value: boolean;
  turnId: string;
  traceId: string;
}

interface FakeScore {
  id: string;
  name: string;
  value: boolean;
  comment: null;
  timestamp: string;
  updatedAt: string;
  environment: string;
  subject: { kind: 'observation'; id: string; traceId: string };
}

function makeScore({ name, value, turnId, traceId }: ScoreSpec): FakeScore {
  return {
    id: `${traceId}:${turnId}:${name}`,
    name,
    value,
    comment: null,
    timestamp: '2026-09-10T10:05:00.000Z',
    updatedAt: '2026-09-10T10:05:01.000Z',
    environment: 'production',
    subject: { kind: 'observation', id: turnId, traceId },
  };
}

const TURNS = [
  makeTurn({ id: 'turn-1', traceId: 'trace-a', sessionId: 'session-1', minute: 1 }),
  makeTurn({ id: 'turn-2', traceId: 'trace-b', sessionId: 'session-1', minute: 2 }),
  makeTurn({ id: 'turn-3', traceId: 'trace-b', sessionId: 'session-1', minute: 3 }),
];

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

interface FakeProject {
  environmentRows: Array<{ environment: string; count_count: string }>;
  environmentsFail: boolean;
  noRatings: boolean;
  projectName: string;
  /** Extra turns added to every conversation, to stand for a session far longer than expected. */
  extraTurnsPerSession: number;
}

function makeFetch(
  requested: string[],
  { environmentRows, environmentsFail, noRatings, projectName, extraTurnsPerSession }: FakeProject,
): typeof fetch {
  return (input) => {
    const url = new URL(requestUrl(input));
    requested.push(`${url.pathname}${url.search}`);
    const json = (data: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(data)));
    if (url.pathname === '/api/public/projects')
      return json({ data: [{ id: 'p1', name: projectName }] });
    if (url.pathname === '/api/public/v2/metrics') {
      if (environmentsFail) return Promise.resolve(new Response('no', { status: 403 }));
      return json({ data: environmentRows });
    }
    if (url.pathname === '/api/public/v3/scores') {
      if (noRatings) return json({ data: [], meta: {} });
      const wantedTrace = url.searchParams.get('traceId');
      const onlyWanted = (scores: FakeScore[]): FakeScore[] =>
        scores.filter((score) => wantedTrace === null || score.subject.traceId === wantedTrace);
      return json({
        data: onlyWanted([
          makeScore({
            name: 'feedback_helpful',
            value: false,
            turnId: 'turn-1',
            traceId: 'trace-a',
          }),
          makeScore({
            name: 'feedback_wrong_answer',
            value: true,
            turnId: 'turn-1',
            traceId: 'trace-a',
          }),
          makeScore({
            name: 'feedback_helpful',
            value: true,
            turnId: 'turn-3',
            traceId: 'trace-b',
          }),
        ]),
        meta: {},
      });
    }
    const traceId = url.searchParams.get('traceId');
    const sessionId = url.searchParams.get('sessionId');
    const data = TURNS.filter((turn) => turn.traceId === traceId || turn.sessionId === sessionId);
    const filler = sessionId
      ? Array.from({ length: extraTurnsPerSession }, (_unused, index) =>
          makeTurn({ id: `filler-${index}`, traceId: 'trace-b', sessionId, minute: 4 }),
        )
      : [];
    return json({ data: [...data, ...filler], meta: {} });
  };
}

function makeReporter(): Reporter {
  const task = { update: () => undefined, succeed: () => undefined, fail: () => undefined };
  return {
    task: () => task,
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
}

function makeResolved(): ResolvedConfig {
  return makeMockResolvedConfig({
    profile: { baseUrl: 'https://langfuse.example.com' },
    outDir: '/tmp/reports',
  });
}

const DEFAULT_PROJECT: FakeProject = {
  projectName: 'acme-development',
  environmentRows: [
    { environment: 'production', count_count: '9' },
    { environment: 'preprod', count_count: '4' },
  ],
  environmentsFail: false,
  noRatings: false,
  extraTurnsPerSession: 0,
};

async function loadWarnings(project: Partial<FakeProject>, profileName: string): Promise<string[]> {
  const warnings: string[] = [];
  const reporter: Reporter = { ...makeReporter(), warn: (text) => void warnings.push(text) };
  const original = globalThis.fetch;
  globalThis.fetch = makeFetch([], { ...DEFAULT_PROJECT, ...project });
  try {
    await loadDataset({ ...makeResolved(), profileName }, reporter);
  } finally {
    globalThis.fetch = original;
  }
  return warnings;
}

async function load(
  requested: string[] = [],
  project: Partial<FakeProject> = {},
  options: Parameters<typeof loadDataset>[2] = {},
): ReturnType<typeof loadDataset> {
  const original = globalThis.fetch;
  globalThis.fetch = makeFetch(requested, { ...DEFAULT_PROJECT, ...project });
  try {
    return await loadDataset(makeResolved(), makeReporter(), options);
  } finally {
    globalThis.fetch = original;
  }
}

describe('loadDataset', () => {
  it('should make one row per rated turn when two turns of different traces were rated', async () => {
    const { rows } = await load();

    expect(rows.map((row) => [row.observationId, row.rating])).toEqual([
      ['turn-1', 'negative'],
      ['turn-3', 'positive'],
    ]);
  });

  it('should number the rated turn within its whole conversation when the session spans traces', async () => {
    const { rows } = await load();

    expect(rows.map((row) => `${row.turnNumber}/${row.conversationTurns}`)).toEqual(['1/3', '3/3']);
  });

  it('should attach the reasons ticked on the same turn when a turn has reason scores', async () => {
    const { rows } = await load();

    expect(rows[0]?.categories).toEqual(['wrong_answer']);
  });

  it('should show the question and answer of the rated turn when building rows', async () => {
    const { rows } = await load();

    expect([rows[1]?.ratedUser, rows[1]?.ratedAssistant]).toEqual([
      'question turn-3',
      'answer turn-3',
    ]);
  });

  it('should ask for chat-turn rows only when the turns are fetched first by trace and then by conversation', async () => {
    const requested: string[] = [];
    await load(requested);

    expect(requested.filter((call) => call.startsWith('/api/public/v2/observations'))).toEqual([
      '/api/public/v2/observations?traceId=trace-a&name=chat-turn&fields=core%2Cbasic%2Cio&limit=1000',
      '/api/public/v2/observations?traceId=trace-b&name=chat-turn&fields=core%2Cbasic%2Cio&limit=1000',
      '/api/public/v2/observations?sessionId=session-1&name=chat-turn&fields=core%2Cbasic%2Cio&limit=1000',
    ]);
  });

  it('should never read the full trace endpoint when loading', async () => {
    const requested: string[] = [];
    await load(requested);

    expect(requested.some((call) => call.startsWith('/api/public/traces/'))).toBe(false);
  });
});

/** A fake Langfuse that reports `count` ratings, to test the size guard without making real turns. */
function makeBigFetch(count: number, requested: string[]): typeof fetch {
  return (input) => {
    const url = new URL(requestUrl(input));
    requested.push(url.pathname);
    const json = (data: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(data)));
    if (url.pathname === '/api/public/projects')
      return json({ data: [{ id: 'p1', name: 'prod' }] });
    if (url.pathname === '/api/public/v3/scores') {
      const scores = Array.from({ length: count }, (_, index) =>
        makeScore({
          name: 'feedback_helpful',
          value: true,
          turnId: `turn-${index}`,
          traceId: `trace-${index}`,
        }),
      );
      return json({ data: onlyNamed(scores, url), meta: {} });
    }
    return json({ data: [], meta: {} });
  };
}

async function loadBig(count: number, options: { yes?: boolean; forceLarge?: boolean }) {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = makeBigFetch(count, requested);
  try {
    const outcome = await loadDataset(makeResolved(), makeReporter(), options).then(
      () => 'loaded',
      (err: Error) => err.message,
    );
    return { outcome, requested };
  } finally {
    globalThis.fetch = original;
  }
}

describe('loadDataset size guard', () => {
  it('should stop before downloading any turn when the run is over the confirmation size', async () => {
    const { outcome, requested } = await loadBig(6_000, {});

    expect(outcome).toContain('--yes');
    expect(requested.some((path) => path.includes('observations'))).toBe(false);
  });

  it('should go ahead when the run is large and the user said yes', async () => {
    const { outcome } = await loadBig(6_000, { yes: true });

    expect(outcome).toBe('loaded');
  });

  it('should still refuse a run over the refusal size when the user only said yes', async () => {
    const { outcome } = await loadBig(30_000, { yes: true });

    expect(outcome).toContain('--force-large');
  });

  it('should go ahead with a run over the refusal size when the user forces it', async () => {
    const { outcome } = await loadBig(30_000, { forceLarge: true });

    expect(outcome).toBe('loaded');
  }, 30_000);

  it('should not ask anything when the run is of normal size', async () => {
    const { outcome } = await loadBig(300, {});

    expect(outcome).toBe('loaded');
  });
});

/** Scores for `ratings` rated turns, each with one reason tick, so there are twice as many scores as ratings. */
function makeScoresWithReasons(ratings: number): object[] {
  return Array.from({ length: ratings }, (_, index) => [
    makeScore({
      name: 'feedback_helpful',
      value: false,
      turnId: `turn-${index}`,
      traceId: `trace-${index}`,
    }),
    makeScore({
      name: 'feedback_other_issue',
      value: true,
      turnId: `turn-${index}`,
      traceId: `trace-${index}`,
    }),
  ]).flat();
}

/** Like the real API, answers only with the score names that were asked for. */
function onlyNamed(scores: object[], url: URL): object[] {
  const asked = (url.searchParams.get('name') ?? '').split(',');
  return scores.filter((score) => asked.includes((score as { name: string }).name));
}

async function loadWithScores(scores: object[], options: { yes?: boolean } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(requestUrl(input));
    const json = (data: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(data)));
    if (url.pathname === '/api/public/projects')
      return json({ data: [{ id: 'p1', name: 'prod' }] });
    if (url.pathname === '/api/public/v3/scores')
      return json({ data: onlyNamed(scores, url), meta: {} });
    return json({ data: [], meta: {} });
  };
  try {
    return await loadDataset(makeResolved(), makeReporter(), options).then(
      () => 'loaded',
      (err: Error) => err.message,
    );
  } finally {
    globalThis.fetch = original;
  }
}

describe('loadDataset counting', () => {
  it('should count ratings and not reason ticks when judging the size of a run', async () => {
    const outcome = await loadWithScores(makeScoresWithReasons(3_000));

    expect(outcome).toBe('loaded');
  });

  it('should still ask first when the ratings alone are over the confirmation size', async () => {
    const outcome = await loadWithScores(makeScoresWithReasons(5_001));

    expect(outcome).toContain('--yes');
  });

  it('should skip a score when it has no subject', async () => {
    const orphan = {
      ...makeScore({ name: 'feedback_helpful', value: true, turnId: 'x', traceId: 'y' }),
      subject: undefined,
    };

    const outcome = await loadWithScores([orphan]);

    expect(outcome).toBe('loaded');
  });
});

describe('loadDataset with an unreadable env file', () => {
  it('should say the env file cannot be read when keys are needed', async () => {
    const resolved = makeMockResolvedConfig({
      publicKey: undefined,
      secretKey: undefined,
      envFileProblem: 'Cannot read the env file /x/dev.env: ENOENT',
    });

    await expect(loadDataset(resolved, makeReporter())).rejects.toThrow(
      'Cannot read the env file /x/dev.env: ENOENT',
    );
  });
});

describe('loadDataset server-side filters', () => {
  const scoreRequests = (requested: string[]): URLSearchParams[] =>
    requested
      .filter((call) => call.startsWith('/api/public/v3/scores'))
      .map((call) => new URL(call, 'https://x.example').searchParams);

  it('should ask Langfuse for the trace only when the filter pins a trace', async () => {
    const requested: string[] = [];

    await load(requested, {}, { where: 'trace = trace-a' });

    expect(scoreRequests(requested).map((params) => params.get('traceId'))).toEqual([
      'trace-a',
      'trace-a',
    ]);
  });

  it('should give the same rows as filtering after the download when the trace is pinned', async () => {
    const { rows } = await load([], {}, { where: 'trace = trace-a' });

    expect(rows.map((row) => row.observationId)).toEqual(['turn-1']);
  });

  it('should ask for no trace when the filter does not pin one', async () => {
    const requested: string[] = [];

    await load(requested, {}, { where: 'rating = negative' });

    expect(scoreRequests(requested).map((params) => params.has('traceId'))).toEqual([false, false]);
  });

  it('should ask for no trace when the filter does not parse', async () => {
    const requested: string[] = [];

    await load(requested, {}, { where: 'trace = ' });

    expect(scoreRequests(requested).map((params) => params.has('traceId'))).toEqual([false, false]);
  });
});

describe('loadDataset turn budget', () => {
  it('should stop and name the way out when a conversation is far longer than expected', async () => {
    await expect(load([], { extraTurnsPerSession: 5_000 })).rejects.toThrow(
      /hold more than 1000 turns.*shorter window.*--force-large/s,
    );
  });

  it('should read the whole conversation when --force-large is given', async () => {
    const { rows } = await load([], { extraTurnsPerSession: 5_000 }, { forceLarge: true });

    expect(rows.map((row) => row.observationId)).toEqual(['turn-1', 'turn-3']);
  });

  it('should read a normal conversation without stopping when it is within the budget', async () => {
    const { rows } = await load([], { extraTurnsPerSession: 20 });

    expect(rows.length).toBe(2);
  });
});

describe('loadDataset environments', () => {
  it('should know the project environments when no rating was loaded', async () => {
    const { context } = await load([], { noRatings: true });

    expect(context.dynamicValues?.env).toEqual(['preprod', 'production']);
  });

  it('should list the environments from Langfuse when ratings exist', async () => {
    const { context } = await load();

    expect(context.dynamicValues?.env).toEqual(['preprod', 'production']);
  });

  it('should fall back to the loaded ratings when Langfuse refuses the environment lookup', async () => {
    const { context } = await load([], { environmentsFail: true });

    expect(context.dynamicValues?.env).toEqual(['production']);
  });

  it('should suggest only the application environments when Langfuse has its own too', async () => {
    const { context } = await load([], {
      environmentRows: [
        { environment: 'default', count_count: '40' },
        { environment: 'langfuse-llm-as-a-judge', count_count: '12' },
        { environment: 'sdk-experiment', count_count: '3' },
        { environment: 'preprod', count_count: '4' },
        { environment: 'production', count_count: '9' },
      ],
    });

    expect(context.suggestedValues?.env).toEqual(['preprod', 'production']);
  });

  it('should still accept a Langfuse environment when it is typed in full', async () => {
    const { context } = await load([], {
      environmentRows: [
        { environment: 'default', count_count: '40' },
        { environment: 'production', count_count: '9' },
      ],
    });

    expect(context.dynamicValues?.env).toEqual(['default', 'production']);
  });

  it('should ask for the observation count grouped by environment when the environments are listed', async () => {
    const requested: string[] = [];
    await load(requested);

    expect(
      decodeURIComponent(
        requested.find((call) => call.startsWith('/api/public/v2/metrics')) ?? '',
      ).includes('"dimensions":[{"field":"environment"}]'),
    ).toBe(true);
  });
});

describe('loadDataset production warning', () => {
  it('should warn that real customers are involved when the project is production', async () => {
    const warnings = await loadWarnings({ projectName: 'acme-production' }, 'dev');

    expect(warnings[0]).toBe(
      'PRODUCTION: profile "dev" reads project "acme-production", which holds real customer conversations. Exports, reports and analyse handle their text; keep the files private.',
    );
  });

  it('should warn when the profile is named prod even if the project is not', async () => {
    const warnings = await loadWarnings({}, 'prod');

    expect(warnings[0]).toContain('PRODUCTION: profile "prod"');
  });

  it('should stay quiet about production when profile and project are development', async () => {
    const warnings = await loadWarnings({}, 'dev');

    expect(warnings.filter((text) => text.startsWith('PRODUCTION'))).toEqual([]);
  });
});

describe('loadDataset dry run', () => {
  const observationCalls = (requested: string[]): string[] =>
    requested.filter((call) => call.startsWith('/api/public/v2/observations'));

  it('should read no conversation when a dry run has no filter on the user or session', async () => {
    const requested: string[] = [];
    await load(requested, {}, { dryRun: true });

    expect(observationCalls(requested)).toEqual([]);
  });

  it('should still count the ratings and their reasons when no conversation is read', async () => {
    const { rows } = await load([], {}, { dryRun: true });

    expect(rows.map((row) => [row.observationId, row.rating, row.categories])).toEqual([
      ['turn-1', 'negative', ['wrong_answer']],
      ['turn-3', 'positive', []],
    ]);
  });

  it('should leave customer text out of the rows when a dry run counts from the ratings alone', async () => {
    const { rows } = await load([], {}, { dryRun: true });

    expect(rows.map((row) => [row.ratedUser, row.ratedAssistant, row.conversation])).toEqual([
      ['', '', ''],
      ['', '', ''],
    ]);
  });

  it('should read the conversations when the dry run filters on the user', async () => {
    const requested: string[] = [];
    await load(requested, {}, { dryRun: true, where: "user = 'U-1'" });

    expect(observationCalls(requested).length).toBeGreaterThan(0);
  });

  it('should read the conversations when the run is not a dry run', async () => {
    const requested: string[] = [];
    await load(requested, {}, { where: "env = 'production'" });

    expect(observationCalls(requested).length).toBeGreaterThan(0);
  });
});

describe('canCountWithoutConversations', () => {
  it.each([
    [{ dryRun: true }, true],
    [{ dryRun: true, where: "env = 'uat-like'" }, true],
    [{ dryRun: true, where: 'rating = negative AND has_comment = true' }, true],
    [{ dryRun: true, where: "user = 'U-1'" }, false],
    [{ dryRun: true, where: "SESSION = 'abc'" }, false],
    [{ where: "env = 'uat-like'" }, false],
    [{}, false],
  ])(
    'should judge the options %j as counting-only = %s when the run is a dry run or not',
    (options, expected) => {
      expect(canCountWithoutConversations(options)).toBe(expected);
    },
  );
});
