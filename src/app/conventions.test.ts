import { makeMockRunInfo } from '../output/__mocks__/makeMockRunInfo.mock.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeMockResolvedConfig } from '../config/__mocks__/makeMockResolvedConfig.mock.js';
import { conventionsSchema } from '../config/config-schema.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { fieldsOf } from '../dsl/fields.js';
import { parseQuery } from '../dsl/parse.js';
import { writeSplitWorkbooks } from '../presets/chat-feedback/write-workbooks.js';
import type { Reporter } from '../ui/reporter.js';
import { loadDataset, scoreNamesFor } from './load-dataset.js';

/** A project that records feedback differently from the defaults. */
const OTHER = conventionsSchema.parse({
  turnName: 'assistant-turn',
  ratingScore: 'thumbs',
  reasonScorePrefix: 'why.',
  reasons: ['wrong', 'slow'],
  yesValues: ['yes'],
  assistantName: 'Aria',
  passLabel: 'Good',
  failLabel: 'Bad',
});

function quietReporter(): Reporter {
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

interface Turn {
  id: string;
  traceId: string;
  sessionId: string;
  name: string;
  startTime: string;
  environment: string;
  userId: string;
  input: string;
  output: string;
}

function turn(id: string, traceId: string, text: string): Turn {
  return {
    id,
    traceId,
    sessionId: 'session-1',
    name: 'assistant-turn',
    startTime: '2026-09-10T10:00:00.000Z',
    environment: 'production',
    userId: 'U-1',
    input: `question ${text}`,
    output: `answer ${text}`,
  };
}

interface ScoreSpec {
  name: string;
  value: string | boolean;
  turnId: string;
  traceId: string;
}

function score({ name, value, turnId, traceId }: ScoreSpec): object {
  return {
    id: `${traceId}:${turnId}:${name}`,
    name,
    value,
    comment: 'because',
    timestamp: '2026-09-10T10:05:00.000Z',
    updatedAt: '2026-09-10T10:05:01.000Z',
    environment: 'production',
    subject: { kind: 'observation', id: turnId, traceId },
  };
}

interface Run {
  requests: URL[];
  rows: Awaited<ReturnType<typeof loadDataset>>['rows'];
}

async function run(
  scores: object[],
  turns: Turn[],
  resolved: ResolvedConfig = makeMockResolvedConfig({ conventions: OTHER }),
): Promise<Run> {
  const requests: URL[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(input instanceof URL ? input.href : (input as string));
    requests.push(url);
    const json = (data: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(data)));
    if (url.pathname === '/api/public/projects') return json({ data: [{ id: 'p', name: 'n' }] });
    if (url.pathname === '/api/public/v3/scores') {
      const asked = (url.searchParams.get('name') ?? '').split(',');
      return json({
        data: scores.filter((s) => asked.includes((s as { name: string }).name)),
        meta: {},
      });
    }
    const traceId = url.searchParams.get('traceId');
    const sessionId = url.searchParams.get('sessionId');
    const name = url.searchParams.get('name');
    return json({
      data: turns.filter(
        (t) => t.name === name && (t.traceId === traceId || t.sessionId === sessionId),
      ),
      meta: {},
    });
  };
  try {
    const dataset = await loadDataset(resolved, quietReporter());
    return { requests, rows: dataset.rows };
  } finally {
    globalThis.fetch = original;
  }
}

async function runForFields() {
  const original = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(input instanceof URL ? input.href : (input as string));
    const json = (data: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(data)));
    if (url.pathname === '/api/public/projects') return json({ data: [{ id: 'p', name: 'n' }] });
    return json({ data: [], meta: {} });
  };
  try {
    const dataset = await loadDataset(
      makeMockResolvedConfig({ conventions: OTHER }),
      quietReporter(),
    );
    return { fields: fieldsOf(dataset.context) };
  } finally {
    globalThis.fetch = original;
  }
}

describe('scoreNamesFor', () => {
  it('should ask for the rating and one score per reason when a reason prefix is configured', () => {
    expect(scoreNamesFor(OTHER)).toEqual(['thumbs', 'why.wrong', 'why.slow']);
  });
});

describe('a Langfuse that records feedback differently', () => {
  const scores = [
    score({ name: 'thumbs', value: 'yes', turnId: 'o1', traceId: 't1' }),
    score({ name: 'why.slow', value: 'yes', turnId: 'o1', traceId: 't1' }),
    score({ name: 'why.wrong', value: 'no', turnId: 'o1', traceId: 't1' }),
  ];

  it('should read the turns that carry the name when a turn name is configured', async () => {
    const { rows } = await run(scores, [turn('o1', 't1', 'a')]);

    expect(rows).toHaveLength(1);
  });

  it('should find nothing when the turns have a different name than the config says', async () => {
    const { rows } = await run(scores, [{ ...turn('o1', 't1', 'a'), name: 'chat-turn' }]);

    expect(rows).toEqual([]);
  });

  it('should ask Langfuse for turns by the name when a turn name is configured', async () => {
    const { requests } = await run(scores, [turn('o1', 't1', 'a')]);

    const names = requests
      .filter((url) => url.pathname.includes('observations'))
      .map((url) => url.searchParams.get('name'));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name === 'assistant-turn')).toBe(true);
  });

  it('should read the rating as positive when it holds the configured yes value', async () => {
    const { rows } = await run(scores, [turn('o1', 't1', 'a')]);

    expect(rows[0]?.rating).toBe('positive');
  });

  it('should treat the rating as thumbs down when it holds any other value', async () => {
    const no = [score({ name: 'thumbs', value: 'no', turnId: 'o1', traceId: 't1' })];

    const { rows } = await run(no, [turn('o1', 't1', 'a')]);

    expect(rows[0]?.rating).toBe('negative');
  });

  it('should strip the prefix from ticked reasons and ignore the unticked ones when reasons are read', async () => {
    const { rows } = await run(scores, [turn('o1', 't1', 'a')]);

    expect(rows[0]?.categories).toEqual(['slow']);
  });

  it('should offer only the configured reasons when the category filter is completed', async () => {
    const { fields } = await runForFields();

    expect(fields.find((f) => f.name === 'category')?.values).toEqual(['wrong', 'slow']);
  });

  it('should refuse the filter when it names a reason that is not in the config', async () => {
    const { fields } = await runForFields();

    expect(() => parseQuery('category = wrong_answer', { now: new Date(), fields })).toThrow(
      'not a valid category',
    );
  });
});

describe('the first pass counts ratings only', () => {
  it('should ask for the rating score alone when the size check runs first', async () => {
    const { requests } = await run(
      [score({ name: 'thumbs', value: 'yes', turnId: 'o1', traceId: 't1' })],
      [turn('o1', 't1', 'a')],
    );

    const first = requests.find((url) => url.pathname === '/api/public/v3/scores');
    expect(first?.searchParams.get('name')).toBe('thumbs');
    expect(first?.searchParams.get('fields')).toBe('subject');
  });

  it('should ask for reasons and comments only when the second pass runs', async () => {
    const { requests } = await run(
      [score({ name: 'thumbs', value: 'yes', turnId: 'o1', traceId: 't1' })],
      [turn('o1', 't1', 'a')],
    );

    const passes = requests.filter((url) => url.pathname === '/api/public/v3/scores');
    expect(passes[1]?.searchParams.get('name')).toBe('thumbs,why.wrong,why.slow');
    expect(passes[1]?.searchParams.get('fields')).toBe('details,subject');
  });

  it('should not fetch turns when a reason score has no rating', async () => {
    const orphan = [score({ name: 'why.slow', value: 'yes', turnId: 'o9', traceId: 'tX' })];

    const { requests } = await run(orphan, []);

    expect(requests.some((url) => url.pathname.includes('observations'))).toBe(false);
  });
});

describe('observation ids are only unique within a trace', () => {
  it('should keep two ratings apart when two traces reuse the same observation id', async () => {
    const scoresTwo = [
      score({ name: 'thumbs', value: 'yes', turnId: 'same', traceId: 't1' }),
      score({ name: 'thumbs', value: 'no', turnId: 'same', traceId: 't2' }),
    ];
    const turns = [
      { ...turn('same', 't1', 'first'), sessionId: 's-1' },
      { ...turn('same', 't2', 'second'), sessionId: 's-2' },
    ];

    const { rows } = await run(scoresTwo, turns);

    expect(rows.map((r) => [r.rating, r.ratedUser])).toEqual([
      ['positive', 'question first'],
      ['negative', 'question second'],
    ]);
  });

  it('should not borrow another trace’s reasons when the observation id repeats', async () => {
    const scoresTwo = [
      score({ name: 'thumbs', value: 'yes', turnId: 'same', traceId: 't1' }),
      score({ name: 'why.slow', value: 'yes', turnId: 'same', traceId: 't2' }),
      score({ name: 'thumbs', value: 'no', turnId: 'same', traceId: 't2' }),
    ];
    const turns = [
      { ...turn('same', 't1', 'first'), sessionId: 's-1' },
      { ...turn('same', 't2', 'second'), sessionId: 's-2' },
    ];

    const { rows } = await run(scoresTwo, turns);

    expect(rows.find((r) => r.traceId === 't1')?.categories).toEqual([]);
  });
});

describe('the Excel files use the configured words', () => {
  it('should show the configured labels and assistant name when a report is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-'));
    const { rows } = await run(
      [score({ name: 'thumbs', value: 'yes', turnId: 'o1', traceId: 't1' })],
      [turn('o1', 't1', 'a')],
    );

    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'x',
      rows,
      source: {
        project: { id: 'p', name: 'n' },
        baseUrl: 'https://x.test',
        labels: OTHER,
        window: 'w',
        filter: 'none',
        run: makeMockRunInfo(),
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(dir, 'feedback-positive-x.xlsx'));
    const sheet = workbook.worksheets[0];
    expect(sheet?.getRow(1).getCell(2).text).toBe('Result');
    expect(sheet?.getRow(1).getCell(6).text).toBe('Answer (Aria)');
    expect(sheet?.getRow(2).getCell(2).text).toBe('Good');
  });
});

describe('lookups follow ratings, not reason scores', () => {
  it('should fetch turns only when the trace has a rating', async () => {
    const scores = [
      score({ name: 'thumbs', value: 'yes', turnId: 'o1', traceId: 't1' }),
      score({ name: 'why.slow', value: 'yes', turnId: 'o9', traceId: 'orphan-trace' }),
    ];

    const { requests } = await run(scores, [turn('o1', 't1', 'a')]);

    const traces = requests
      .filter((url) => url.searchParams.has('traceId'))
      .map((url) => url.searchParams.get('traceId'));
    expect(traces).toEqual(['t1']);
  });

  it('should not download comments when the size check has not run yet', async () => {
    const { requests } = await run(
      [score({ name: 'thumbs', value: 'yes', turnId: 'o1', traceId: 't1' })],
      [turn('o1', 't1', 'a')],
    );

    const firstScoreRequest = requests.find((url) => url.pathname === '/api/public/v3/scores');
    expect(firstScoreRequest?.searchParams.get('fields')).toBe('subject');
  });
});
