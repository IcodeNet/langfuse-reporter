import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeMockRunInfo } from '../output/__mocks__/makeMockRunInfo.mock.js';
import type { ExportRow } from '../presets/chat-feedback/build-rows.js';
import {
  writeSplitWorkbooks,
  type WorkbookSource,
} from '../presets/chat-feedback/write-workbooks.js';
import type { Reporter } from '../ui/reporter.js';
import { comparisonFileName, runCompare } from './run-compare.js';
import { readReportFile } from './read-report.js';

const SOURCE: WorkbookSource = {
  project: { id: 'proj1', name: 'acme-development' },
  baseUrl: 'https://cloud.langfuse.com',
  labels: { assistantName: 'Assistant', passLabel: 'Pass', failLabel: 'Fail' },
  window: '2026-10-13 to 2026-10-15',
  filter: 'none',
  run: makeMockRunInfo(),
};

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-1',
    sessionId: 'session-1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: '',
    environment: 'uat-like',
    created: Date.parse('2026-10-14T10:00:00Z'),
    userId: 'u1',
    observationId: 'obs-1',
    turnNumber: 1,
    ratedUser: 'what is the best rate',
    ratedAssistant: 'It depends.',
    conversationTurns: 1,
    conversation: '[1] User: what is the best rate',
    ...overrides,
  };
}

/** Writes a real report with the same code the export uses, and returns its negative file. */
async function writeReport(rows: ExportRow[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
  const paths = await writeSplitWorkbooks({ outDir: dir, stem: 'r', rows, source: SOURCE });
  return paths.negative ?? paths.positive ?? '';
}

function makeReporter(lines: string[] = []): Reporter {
  const task = {
    update: () => undefined,
    succeed: (text?: string) => void lines.push(`ok: ${text ?? ''}`),
    fail: (text?: string) => void lines.push(`fail: ${text ?? ''}`),
  };
  return {
    task: () => task,
    done: (text) => void lines.push(text),
    info: (text) => void lines.push(text),
    note: (text) => void lines.push(text),
    styled: (text) => void lines.push(text),
    document: (text) => void lines.push(text),
    warn: (text) => void lines.push(`warn: ${text}`),
    block: () => undefined,
    section: (_title, body) => Promise.resolve(body()),
    cancel: () => undefined,
  };
}

describe('readReportFile', () => {
  it('should read the question, answer, reasons and result back when a report was written by the export', async () => {
    const path = await writeReport([makeRow({ comment: 'too vague' })]);

    const file = await readReportFile(path);

    expect(file.rows).toMatchObject([
      {
        question: 'what is the best rate',
        answer: 'It depends.',
        reasons: 'other_issue',
        comment: 'too vague',
        result: 'negative',
      },
    ]);
  });

  it('should read a positive rating as positive when the setup sheet names the pass label', async () => {
    const path = await writeReport([makeRow({ rating: 'positive' })]);

    const file = await readReportFile(path);

    expect(file.rows.map((row) => row.result)).toEqual(['positive']);
  });

  it('should keep the link to the rated turn when the report has one', async () => {
    const file = await readReportFile(await writeReport([makeRow()]));

    expect(file.rows[0]?.link?.hyperlink).toBe(
      'https://cloud.langfuse.com/project/proj1/traces/trace-1?observation=obs-1',
    );
  });

  it('should read the setup of the report when it has a Config and filters sheet', async () => {
    const file = await readReportFile(await writeReport([makeRow()]));

    expect([file.setup['Profile'], file.setup['Rating score']]).toEqual([
      'dev',
      'feedback_helpful',
    ]);
  });

  it('should name the file and the sheets it has when it is not a report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
    const path = join(dir, 'other.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Budget');
    await workbook.xlsx.writeFile(path);

    await expect(readReportFile(path)).rejects.toThrow(
      `${path} has no "Feedback per turn" sheet (it has: Budget). Use a file written by "feedback export" or "save".`,
    );
  });

  it('should say the file is not an Excel file when it is plain text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
    const path = join(dir, 'x.xlsx');
    writeFileSync(path, 'not a zip');

    await expect(readReportFile(path)).rejects.toThrow('is not an Excel file I can read');
  });

  it('should say the file does not exist when the path is wrong', async () => {
    await expect(readReportFile('/nonexistent/a.xlsx')).rejects.toThrow(
      '/nonexistent/a.xlsx does not exist',
    );
  });
});

describe('comparisonFileName', () => {
  it('should name both files and stay inside the folder when the paths have odd characters', () => {
    expect(comparisonFileName('/a/b/Before Report!.xlsx', '/x/../y/after.xlsx')).toBe(
      'compare-Before-Report---vs--after.xlsx',
    );
  });
});

describe('runCompare', () => {
  async function run(before: ExportRow[], after: ExportRow[]) {
    const lines: string[] = [];
    const outDir = mkdtempSync(join(tmpdir(), 'cmp-out-'));
    const written = await runCompare({
      beforePath: await writeReport(before),
      afterPath: await writeReport(after),
      outDir,
      reporter: makeReporter(lines),
    });
    return { written, lines };
  }

  it('should write a three-sheet workbook and count the verdicts when both reports have ratings', async () => {
    const { written, lines } = await run(
      [makeRow(), makeRow({ ratedUser: 'second question', observationId: 'obs-2' })],
      [makeRow()],
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(written ?? '');
    expect([
      workbook.worksheets.map((sheet) => sheet.name),
      lines.filter((l) => /^\s*\d+\s+/.test(l)),
    ]).toEqual([
      ['1 Before', '2 After', '3 Comparison'],
      ['   1  still negative', '   1  improved: not negative this time'],
    ]);
  });

  it('should write the verdict and both setups when the comparison sheet is built', async () => {
    const { written } = await run(
      [makeRow()],
      [makeRow({ ratedUser: 'a new question', observationId: 'o9' })],
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(written ?? '');
    const cells: string[] = [];
    workbook.getWorksheet('3 Comparison')?.eachRow((row) => cells.push(row.getCell(1).text));
    expect(cells).toEqual(
      expect.arrayContaining([
        'improved: not negative this time',
        'new problem',
        'Profile',
        'Filter',
      ]),
    );
  });

  it('should refuse and say why when the first file is missing', async () => {
    const lines: string[] = [];
    const written = await runCompare({
      beforePath: '/nonexistent/a.xlsx',
      afterPath: await writeReport([makeRow()]),
      outDir: mkdtempSync(join(tmpdir(), 'cmp-out-')),
      reporter: makeReporter(lines),
    });

    expect([written, lines]).toEqual([undefined, ['fail: /nonexistent/a.xlsx does not exist']]);
  });

  it('should refuse before reading anything when the output folder is a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmp-out-'));
    const notAFolder = join(dir, 'file');
    writeFileSync(notAFolder, 'x');
    const lines: string[] = [];

    const written = await runCompare({
      beforePath: '/nonexistent/a.xlsx',
      afterPath: '/nonexistent/b.xlsx',
      outDir: notAFolder,
      reporter: makeReporter(lines),
    });

    expect([written, lines[0]?.includes('is a file, not a folder')]).toEqual([undefined, true]);
  });
});
