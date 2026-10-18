import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportRow } from './build-rows.js';
import { makeMockRunInfo } from '../../output/__mocks__/makeMockRunInfo.mock.js';
import { turnUrl, writeSplitWorkbooks, type WorkbookSource } from './write-workbooks.js';

const SOURCE: WorkbookSource = {
  project: { id: 'proj123', name: 'acme-development' },
  baseUrl: 'https://cloud.langfuse.com',
  labels: { assistantName: 'Assistant', passLabel: 'Pass', failLabel: 'Fail' },
  window: '2026-09-01 to 2026-10-01 (UTC, end date not included)',
  filter: 'none',
  run: makeMockRunInfo(),
};

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-abc',
    sessionId: 'session-1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: 'not helpful',
    environment: 'uat-like',
    created: Date.parse('2026-09-02T10:00:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    turnNumber: 1,
    ratedUser: 'hello',
    ratedAssistant: 'hi',
    conversationTurns: 1,
    conversation: '[1] User: hello',
    ...overrides,
  };
}

/** Reads the first data row as header -> value, because keys are not stored in the file. */
async function readFirstRow(path: string): Promise<Record<string, ExcelJS.CellValue>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0]!;
  const result: Record<string, ExcelJS.CellValue> = {};
  sheet.getRow(1).eachCell((cell, column) => {
    result[cell.text] = sheet.getRow(2).getCell(column).value;
  });
  return result;
}

async function countRows(path: string): Promise<number> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook.worksheets[0]!.rowCount;
}

describe('writeSplitWorkbooks', () => {
  it('should write one positive and one negative file when both sides have ratings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'both',
      rows: [makeRow({ rating: 'positive' }), makeRow({ rating: 'negative' })],
      source: SOURCE,
    });

    expect(readdirSync(dir).sort()).toEqual([
      'feedback-negative-both.xlsx',
      'feedback-positive-both.xlsx',
    ]);
  });

  it('should write only the negative file when there are no positive ratings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    const paths = await writeSplitWorkbooks({
      outDir: dir,
      stem: 'neg',
      rows: [makeRow({ rating: 'negative' })],
      source: SOURCE,
    });

    expect([readdirSync(dir), paths.positive === undefined]).toEqual([
      ['feedback-negative-neg.xlsx'],
      true,
    ]);
  });

  it('should write no file when nothing was selected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'none', rows: [], source: SOURCE });

    expect(readdirSync(dir)).toEqual([]);
  });

  it('should remove a stale file of the same name when that side is now empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));
    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'again',
      rows: [makeRow({ rating: 'positive' }), makeRow({ rating: 'negative' })],
      source: SOURCE,
    });

    const second = await writeSplitWorkbooks({
      outDir: dir,
      stem: 'again',
      rows: [makeRow({ rating: 'negative' })],
      source: SOURCE,
    });

    expect([readdirSync(dir), second.replaced]).toEqual([['feedback-negative-again.xlsx'], true]);
  });

  it('should refuse to write when the name could escape the folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await expect(
      writeSplitWorkbooks({ outDir: dir, stem: '../../etc/x', rows: [], source: SOURCE }),
    ).rejects.toThrow('is not a safe file name');
  });

  it('should write nothing when the name is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'a/b', rows: [], source: SOURCE }).catch(
      () => undefined,
    );

    expect(readdirSync(dir)).toEqual([]);
  });

  it('should replace the earlier rows when the same name is written twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));
    const rows = [makeRow({ traceId: 't1' }), makeRow({ traceId: 't2' })];

    await writeSplitWorkbooks({ outDir: dir, stem: 'same', rows: rows, source: SOURCE });
    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'same',
      rows: [makeRow({ traceId: 't3' })],
      source: SOURCE,
    });

    expect(await countRows(join(dir, 'feedback-negative-same.xlsx'))).toBe(2);
  });

  it('should keep the earlier file when a second name is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'first', rows: [makeRow()], source: SOURCE });
    await writeSplitWorkbooks({ outDir: dir, stem: 'second', rows: [makeRow()], source: SOURCE });

    expect(readdirSync(dir).sort()).toEqual([
      'feedback-negative-first.xlsx',
      'feedback-negative-second.xlsx',
    ]);
  });

  it('should write the project name beside each trace when rows are exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'p', rows: [makeRow()], source: SOURCE });

    const row = await readFirstRow(join(dir, 'feedback-negative-p.xlsx'));
    expect(row['Project']).toBe('acme-development');
  });

  it('should link each trace to the project it came from when rows are exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'l',
      rows: [makeRow({ traceId: 'trace-abc' })],
      source: SOURCE,
    });

    const row = await readFirstRow(join(dir, 'feedback-negative-l.xlsx'));
    expect(row['Trace link']).toEqual({
      text: 'Open',
      hyperlink: 'https://cloud.langfuse.com/project/proj123/traces/trace-abc?observation=obs-1',
    });
  });

  it('should put positive ratings only in the positive file when both kinds exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));
    const rows = [makeRow({ rating: 'positive', traceId: 'up' }), makeRow({ traceId: 'down' })];

    await writeSplitWorkbooks({ outDir: dir, stem: 'split', rows: rows, source: SOURCE });

    const row = await readFirstRow(join(dir, 'feedback-positive-split.xlsx'));
    expect(row['Trace id']).toBe('up');
  });
});

describe('writeSplitWorkbooks layout', () => {
  async function firstSheet(dir: string, file: string): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(dir, file));
    return workbook.worksheets[0]!;
  }

  it('should label a positive rating Pass when it is exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'r',
      rows: [makeRow({ rating: 'positive' })],
      source: SOURCE,
    });

    const row = await readFirstRow(join(dir, 'feedback-positive-r.xlsx'));
    expect(row['Result']).toBe('Pass');
  });

  it('should label a negative rating Fail when it is exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'r', rows: [makeRow()], source: SOURCE });

    const row = await readFirstRow(join(dir, 'feedback-negative-r.xlsx'));
    expect(row['Result']).toBe('Fail');
  });

  it('should name the question and answer columns the same way when the CSV workbook is compared', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'c', rows: [makeRow()], source: SOURCE });

    const row = await readFirstRow(join(dir, 'feedback-negative-c.xlsx'));
    expect([row['Question (customer)'], row['Answer (Assistant)']]).toEqual(['hello', 'hi']);
  });

  it('should shade a failing result red when it is exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 's', rows: [makeRow()], source: SOURCE });

    const sheet = await firstSheet(dir, 'feedback-negative-s.xlsx');
    expect(sheet.getRow(2).getCell(2).fill).toMatchObject({ fgColor: { argb: 'FFF8D7DA' } });
  });

  it('should add a method sheet that names the project and the window when exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'm', rows: [makeRow()], source: SOURCE });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(dir, 'feedback-negative-m.xlsx'));
    const method = workbook.getWorksheet('Method and caveats')!;
    expect(method.getCell('B3').text).toContain('acme-development');
    expect(method.getCell('B4').text).toContain('2026-09-01 to 2026-10-01');
  });

  it('should freeze the header row and the first two columns when exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({ outDir: dir, stem: 'f', rows: [makeRow()], source: SOURCE });

    const sheet = await firstSheet(dir, 'feedback-negative-f.xlsx');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 1 });
  });
});

describe('writeSplitWorkbooks replacing', () => {
  it('should report no replacement when the files are new', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    const paths = await writeSplitWorkbooks({
      outDir: dir,
      stem: 'fresh',
      rows: [],
      source: SOURCE,
    });

    expect(paths.replaced).toBe(false);
  });

  it('should report a replacement when the same name is written again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));
    await writeSplitWorkbooks({ outDir: dir, stem: 'again', rows: [makeRow()], source: SOURCE });

    const paths = await writeSplitWorkbooks({
      outDir: dir,
      stem: 'again',
      rows: [makeRow()],
      source: SOURCE,
    });

    expect(paths.replaced).toBe(true);
  });

  it('should keep the replaced flag false when a different name is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));
    await writeSplitWorkbooks({ outDir: dir, stem: 'one', rows: [], source: SOURCE });

    const paths = await writeSplitWorkbooks({ outDir: dir, stem: 'two', rows: [], source: SOURCE });

    expect(paths.replaced).toBe(false);
  });
});

describe('writeSplitWorkbooks long text', () => {
  it('should cut the cell and say so when it is longer than Excel allows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'long',
      rows: [makeRow({ ratedAssistant: 'x'.repeat(40_000) })],
      source: SOURCE,
    });

    const row = await readFirstRow(join(dir, 'feedback-negative-long.xlsx'));
    expect(row['Answer (Assistant)']).toEqual(expect.stringMatching(/…\[truncated\]$/));
  });

  it('should leave a cell alone when it fits in Excel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));

    await writeSplitWorkbooks({
      outDir: dir,
      stem: 'short',
      rows: [makeRow({ ratedAssistant: 'fits' })],
      source: SOURCE,
    });

    const row = await readFirstRow(join(dir, 'feedback-negative-short.xlsx'));
    expect(row['Answer (Assistant)']).toBe('fits');
  });
});

describe('turnUrl encoding', () => {
  it('should encode the trace id when it contains characters with a meaning in a URL', () => {
    const url = turnUrl(SOURCE, makeRow({ traceId: 'a/b?c#d', observationId: 'o' }));

    expect(url).toBe(
      'https://cloud.langfuse.com/project/proj123/traces/a%2Fb%3Fc%23d?observation=o',
    );
  });

  it('should encode the project id when the link is built', () => {
    const url = turnUrl(
      { ...SOURCE, project: { id: 'p/1', name: 'n' } },
      makeRow({ traceId: 't', observationId: 'o' }),
    );

    expect(url).toContain('/project/p%2F1/traces/t');
  });
});

describe('turnUrl', () => {
  it('should open the trace with the rated answer selected when given a row', () => {
    expect(turnUrl(SOURCE, makeRow({ traceId: 'abc', observationId: 'obs-9' }))).toBe(
      'https://cloud.langfuse.com/project/proj123/traces/abc?observation=obs-9',
    );
  });
});
