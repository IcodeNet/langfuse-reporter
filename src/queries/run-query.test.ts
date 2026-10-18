import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type ConfigFile } from '../config/config-schema.js';
import type { Reporter } from '../ui/reporter.js';
import type { ExportRow } from '../presets/chat-feedback/build-rows.js';

const loadDataset = vi.fn();
vi.mock('../app/load-dataset.js', () => ({
  loadDataset: (...args: unknown[]) => loadDataset(...args),
}));

const { describeOutcome, overallExit, runSavedQuery } = await import('./run-query.js');

const NOW = new Date('2026-10-16T12:00:00Z');
const REPORTER = {} as Reporter;

function makeRow(rating: 'positive' | 'negative', categories: string[] = []): ExportRow {
  return {
    traceId: 't',
    sessionId: 's',
    rating,
    categories,
    comment: '',
    environment: 'uat-like',
    created: 0,
    userId: 'U',
    observationId: 'o',
    turnNumber: 1,
    ratedUser: 'q',
    ratedAssistant: 'a',
    conversationTurns: 1,
    conversation: '',
  };
}

function datasetOf(rows: ExportRow[]) {
  return { project: { id: 'p', name: 'n' }, rows, notes: {}, context: { now: NOW } };
}

function configWith(queries: ConfigFile['queries']): ConfigFile {
  return {
    ...DEFAULT_CONFIG,
    profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
    queries,
  };
}

async function run(name: string, config: ConfigFile) {
  return runSavedQuery({ name, config, profileOverride: undefined, reporter: REPORTER, now: NOW });
}

beforeEach(() => {
  loadDataset.mockReset();
});

describe('runSavedQuery', () => {
  it('should exit 0 when every rule passes', async () => {
    loadDataset.mockResolvedValue(
      datasetOf([
        makeRow('positive'),
        makeRow('positive'),
        makeRow('positive'),
        makeRow('negative'),
      ]),
    );

    const outcome = await run('q', configWith({ q: { rules: ['negative-rate <= 0.3'] } }));

    expect(outcome.exit).toBe(0);
  });

  it('should exit 1 when a rule fails', async () => {
    loadDataset.mockResolvedValue(datasetOf([makeRow('negative'), makeRow('positive')]));

    const outcome = await run('q', configWith({ q: { rules: ['negative-rate <= 0.1'] } }));

    expect(outcome.exit).toBe(1);
  });

  it('should exit 2 when the query name is not saved', async () => {
    const outcome = await run('missing', configWith({}));

    expect(outcome).toMatchObject({ exit: 2, error: expect.stringContaining('No saved query') });
  });

  it('should exit 2 and carry the message when loading the ratings throws', async () => {
    loadDataset.mockRejectedValue(new Error('Langfuse answered 503'));

    const outcome = await run('q', configWith({ q: { rules: ['count >= 1'] } }));

    expect(outcome).toMatchObject({ exit: 2, error: 'Langfuse answered 503' });
  });

  it('should exit 2 when a rate rule meets an empty window', async () => {
    loadDataset.mockResolvedValue(datasetOf([]));

    const outcome = await run('q', configWith({ q: { rules: ['negative-rate <= 0.2'] } }));

    expect(outcome.exit).toBe(2);
  });

  it('should exit 1 over 2 when one rule fails and another cannot be checked', async () => {
    loadDataset.mockResolvedValue(datasetOf([]));

    const outcome = await run(
      'q',
      configWith({ q: { rules: ['count >= 1', 'negative-rate <= 0.2'] } }),
    );

    expect(outcome.exit).toBe(1);
  });

  it('should exit 0 when the query has no rules', async () => {
    loadDataset.mockResolvedValue(datasetOf([makeRow('negative')]));

    const outcome = await run('q', configWith({ q: { rules: [] } }));

    expect(outcome).toMatchObject({ exit: 0, matched: 1 });
  });

  it('should divide by every rating in the window when a filter narrows the matches', async () => {
    loadDataset.mockResolvedValue(
      datasetOf([
        makeRow('negative', ['wrong_answer']),
        makeRow('positive'),
        makeRow('positive'),
        makeRow('positive'),
      ]),
    );

    const outcome = await run(
      'q',
      configWith({ q: { where: 'category IN (wrong_answer)', rules: ['negative-rate <= 0.25'] } }),
    );

    expect(outcome).toMatchObject({ exit: 0, matched: 1, negative: 1, windowTotal: 4 });
  });

  it('should load the whole window when the query has a filter', async () => {
    loadDataset.mockResolvedValue(datasetOf([]));

    await run('q', configWith({ q: { where: 'rating = negative', rules: [] } }));

    expect(loadDataset.mock.calls[0]?.[2]).toEqual({ yes: undefined });
  });

  it('should use the window of the query when it has one', async () => {
    loadDataset.mockResolvedValue(datasetOf([]));

    await run('q', configWith({ q: { window: '7d', rules: [] } }));

    expect(loadDataset.mock.calls[0]?.[0]).toMatchObject({
      from: '2026-10-10T00:00:00.000Z',
      to: '2026-10-17T00:00:00.000Z',
    });
  });
});

describe('overallExit', () => {
  it('should be 1 when any query failed a rule', () => {
    expect(overallExit([{ exit: 0 }, { exit: 2 }, { exit: 1 }] as never)).toBe(1);
  });

  it('should be 2 when no query failed but one could not be checked', () => {
    expect(overallExit([{ exit: 0 }, { exit: 2 }] as never)).toBe(2);
  });

  it('should be 0 when there are no queries', () => {
    expect(overallExit([])).toBe(0);
  });
});

describe('describeOutcome', () => {
  it('should show one line per rule with the actual value when rules ran', () => {
    const lines = describeOutcome({
      name: 'q',
      exit: 1,
      matched: 3,
      negative: 3,
      windowTotal: 4,
      rules: [{ rule: 'negative-rate <= 0.2', actual: 0.75, status: 'fail' }],
    });

    expect(lines).toEqual([
      'q: FAIL',
      '  FAIL  negative-rate <= 0.2  (actual 0.750)',
      '  3 matched, 3 negative, 4 ratings in the window',
    ]);
  });

  it('should show the error when the check could not be made', () => {
    expect(describeOutcome({ name: 'q', exit: 2, rules: [], error: 'no keys' })).toEqual([
      'q: COULD NOT CHECK',
      '  no keys',
    ]);
  });
});
