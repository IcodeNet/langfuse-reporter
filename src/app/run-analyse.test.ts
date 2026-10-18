import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeMockResolvedConfig } from '../config/__mocks__/makeMockResolvedConfig.mock.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { ExportRow } from '../presets/chat-feedback/build-rows.js';
import { createReporter, type Reporter } from '../ui/reporter.js';
import type { Dataset } from './load-dataset.js';
import { MAX_ANALYSED_RATINGS, runAnalyse } from './run-analyse.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 't1',
    sessionId: 's1',
    observationId: 'o1',
    rating: 'negative',
    categories: ['wrong_answer'],
    comment: 'wrong rate',
    environment: 'production',
    created: Date.parse('2026-09-10T10:00:00Z'),
    userId: 'U-1',
    turnNumber: 1,
    ratedUser: 'best rate?',
    ratedAssistant: '3.5%',
    conversationTurns: 1,
    conversation: '',
    ...overrides,
  };
}

function makeDataset(rows: ExportRow[]): Dataset {
  return {
    project: { id: 'p1', name: 'prod' },
    rows,
    notes: { traceLevelRatings: 0, missingTurns: 0 },
    context: { now: new Date('2026-10-12T00:00:00Z') },
  };
}

function makeResolved(outDir: string, withModel = true): ResolvedConfig {
  return makeMockResolvedConfig({
    outDir,
    llm: withModel ? { provider: 'openai', model: 'm' } : {},
    llmApiKey: withModel ? 'k' : undefined,
  });
}

function makeReporter(): { reporter: Reporter; lines: string[] } {
  const lines: string[] = [];
  const task = {
    update: () => undefined,
    succeed: (text?: string) => void lines.push(`ok ${text ?? ''}`),
    fail: (text?: string) => void lines.push(`fail ${text ?? ''}`),
  };
  const reporter: Reporter = {
    task: () => task,
    done: (text) => void lines.push(text),
    info: (text) => void lines.push(`info ${text}`),
    note: (text) => void lines.push(text),
    styled: (text) => void lines.push(text),
    document: (text) => void lines.push(text),
    warn: (text) => void lines.push(`warn ${text}`),
    block: (block) =>
      void lines.push(`${block.title}: ${block.rows.map((row) => row.join(' ')).join(' | ')}`),
    section: (_title, body) => Promise.resolve(body()),
    cancel: () => undefined,
  };
  return { reporter, lines };
}

async function withModelReply<T>(reply: string, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: reply } }] })));
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('runAnalyse', () => {
  it('should say how to set up a model when none is configured', async () => {
    const { reporter, lines } = makeReporter();

    const path = await runAnalyse({
      dataset: makeDataset([makeRow()]),
      resolved: makeResolved('/tmp/x', false),
      reporter,
    });

    expect(path).toBeUndefined();
    expect(lines.join('\n')).toContain('config set llm.provider');
  });

  it('should say there is nothing to analyse when the filter matches no rating', async () => {
    const { reporter, lines } = makeReporter();

    await runAnalyse({
      dataset: makeDataset([makeRow({ rating: 'positive' })]),
      resolved: makeResolved('/tmp/x'),
      reporter,
      where: 'rating = negative',
    });

    expect(lines.join('\n')).toContain('nothing to analyse');
  });

  it('should refuse to send the ratings when there are more than the limit and --yes is missing', async () => {
    const { reporter, lines } = makeReporter();
    const rows = Array.from({ length: MAX_ANALYSED_RATINGS + 1 }, () => makeRow());

    const path = await runAnalyse({
      dataset: makeDataset(rows),
      resolved: makeResolved('/tmp/x'),
      reporter,
    });

    expect(path).toBeUndefined();
    expect(lines.join('\n')).toContain('--yes');
  });

  it('should write the themes workbook with every rating under its theme when the model answers', async () => {
    const { reporter } = makeReporter();
    const dir = mkdtempSync(join(tmpdir(), 'an-'));
    const rows = [
      makeRow({ observationId: 'o1' }),
      makeRow({ observationId: 'o2', comment: 'rate missing' }),
    ];
    const reply =
      '{"themes":[{"name":"Wrong rates","description":"Quotes a wrong rate","rows":[1,2]}]}';

    const path = await withModelReply(reply, () =>
      runAnalyse({ dataset: makeDataset(rows), resolved: makeResolved(dir), reporter }),
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path?.file ?? '');
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Themes',
      'Ratings by theme',
      'Method and caveats',
      'Config and filters',
    ]);
    expect(workbook.getWorksheet('Themes')?.getRow(2).getCell(2).text).toBe('Wrong rates');
    expect(workbook.getWorksheet('Ratings by theme')?.rowCount).toBe(3);
  });

  it('should name the model in the file when the themes workbook is written', async () => {
    const { reporter } = makeReporter();
    const dir = mkdtempSync(join(tmpdir(), 'an-'));

    const path = await withModelReply('{"themes":[{"name":"A","rows":[1]}]}', () =>
      runAnalyse({ dataset: makeDataset([makeRow()]), resolved: makeResolved(dir), reporter }),
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path?.file ?? '');
    expect(workbook.getWorksheet('Method and caveats')?.getCell('B4').text).toContain('openai / m');
  });

  it('should report the failure and write nothing when the model call fails', async () => {
    const { reporter, lines } = makeReporter();
    const dir = mkdtempSync(join(tmpdir(), 'an-'));
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('denied', { status: 401 }));
    try {
      const path = await runAnalyse({
        dataset: makeDataset([makeRow()]),
        resolved: makeResolved(dir),
        reporter,
      });

      expect(path).toBeUndefined();
      expect(lines.join('\n')).toContain('The analysis failed');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('should keep terminal control sequences off the terminal when a model reply contains them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'an-'));
    const ESC = String.fromCharCode(27);
    const chunks: string[] = [];
    const reporter = createReporter({
      stream: { write: (text: string) => (chunks.push(text), true) },
      interactive: false,
    });
    const hostile = JSON.stringify({
      themes: [
        {
          name: `Wrong rate${ESC}[2J${ESC}]0;pwned${String.fromCharCode(7)}`,
          description: `desc${ESC}[H forged line`,
          rows: [1],
        },
      ],
    });

    await withModelReply(hostile, () =>
      runAnalyse({ dataset: makeDataset([makeRow()]), resolved: makeResolved(dir), reporter }),
    );

    const printed = chunks.join('');
    expect(printed).toContain('Wrong rate');
    expect(printed).not.toContain(ESC);
    expect(printed).not.toContain('pwned');
  });

  it('should return the themes with their counts, the model and the file when the model answers', async () => {
    const { reporter } = makeReporter();
    const dir = mkdtempSync(join(tmpdir(), 'an-'));
    const rows = [
      makeRow({ observationId: 'o1' }),
      makeRow({ observationId: 'o2' }),
      makeRow({ observationId: 'o3' }),
    ];
    const reply =
      '{"themes":[{"name":"Wrong rates","description":"Quotes a wrong rate","rows":[1,2]},{"name":"Slow","description":"Took long","rows":[3]}]}';

    const outcome = await withModelReply(reply, () =>
      runAnalyse({ dataset: makeDataset(rows), resolved: makeResolved(dir), reporter }),
    );

    expect([
      outcome?.ratings,
      outcome?.themes,
      outcome?.unplaced,
      outcome?.masked,
      isAbsolute(outcome?.file ?? ''),
    ]).toEqual([
      3,
      [
        { name: 'Wrong rates', description: 'Quotes a wrong rate', count: 2 },
        { name: 'Slow', description: 'Took long', count: 1 },
      ],
      0,
      true,
      true,
    ]);
  });

  it('should say the ratings were not masked when masking is turned off', async () => {
    const { reporter } = makeReporter();
    const dir = mkdtempSync(join(tmpdir(), 'an-'));

    const outcome = await withModelReply('{"themes":[{"name":"A","rows":[1]}]}', () =>
      runAnalyse({
        dataset: makeDataset([makeRow()]),
        resolved: makeResolved(dir),
        reporter,
        mask: false,
      }),
    );

    expect(outcome?.masked).toBe(false);
  });
});
