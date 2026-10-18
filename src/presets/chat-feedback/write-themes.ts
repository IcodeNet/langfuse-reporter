import { ensureOutDir } from '../../output/check-out-dir.js';
import { addConfigSheet } from './config-sheet.js';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { Analysis } from './analyse-feedback.js';
import type { ExportRow } from './build-rows.js';
import { writePrivateWorkbook } from '../../output/private-file.js';
import { turnUrl, type WorkbookSource } from './write-workbooks.js';

const HEADER_FILL = 'FF1F3864';
const SAFE_STEM = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
/** Excel rejects cell text over 32,767 characters. */
const MAX_CELL_CHARS = 32_000;

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(HEADER_FILL);
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function wrapBody(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });
}

function clip(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…[truncated]` : text;
}

export interface ThemesRequest {
  outDir: string;
  stem: string;
  rows: readonly ExportRow[];
  analysis: Analysis;
  source: WorkbookSource;
  /** "provider / model" that wrote the groups, named in the file so nobody mistakes it for a human review. */
  model: string;
}

function summarySheet(workbook: ExcelJS.Workbook, request: ThemesRequest): void {
  const { rows, analysis } = request;
  const sheet = workbook.addWorksheet('Themes');
  sheet.addRow(['Rank', 'Theme', 'Ratings', '% of ratings', 'What it is']);
  analysis.themes.forEach((theme, index) => {
    sheet.addRow([
      index + 1,
      theme.name,
      theme.rows.length,
      theme.rows.length / rows.length,
      theme.description,
    ]);
    sheet.getCell(`D${index + 2}`).numFmt = '0.0%';
  });
  sheet.addRow(['', 'Total', rows.length, 1, '']);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  [6, 46, 10, 13, 90].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  styleHeader(sheet);
  wrapBody(sheet);
}

function rowsSheet(workbook: ExcelJS.Workbook, request: ThemesRequest): void {
  const { rows, analysis, source } = request;
  const themeOf = new Map<number, string>();
  for (const theme of analysis.themes)
    for (const number of theme.rows) themeOf.set(number, theme.name);
  const sheet = workbook.addWorksheet('Ratings by theme');
  sheet.addRow([
    'Row',
    'Theme',
    'Date (UTC)',
    'Result',
    'Reasons ticked',
    'Comment',
    'Question',
    `Answer (${source.labels.assistantName})`,
    'Trace link',
  ]);
  rows.forEach((row, index) => {
    const added = sheet.addRow([
      index + 1,
      themeOf.get(index + 1) ?? '',
      new Date(row.created).toISOString().slice(0, 19).replace('T', ' '),
      row.rating === 'positive' ? source.labels.passLabel : source.labels.failLabel,
      row.categories.join(', '),
      clip(row.comment),
      clip(row.ratedUser),
      clip(row.ratedAssistant),
      { text: 'Open', hyperlink: turnUrl(source, row) },
    ]);
    added.getCell(9).font = { color: { argb: 'FF0563C1' }, underline: true };
  });
  [6, 40, 19, 8, 34, 60, 60, 80, 11].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  styleHeader(sheet);
  wrapBody(sheet);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
}

function methodSheet(workbook: ExcelJS.Workbook, request: ThemesRequest): void {
  const { rows, analysis, source, model } = request;
  const sheet = workbook.addWorksheet('Method and caveats');
  sheet.addRow(['Item', 'Detail']);
  sheet.addRows([
    [
      'What this is',
      'The common problems in a set of ratings, found by a model. One theme per rating.',
    ],
    [
      'Source',
      `Langfuse project ${source.project.name}. ${rows.length} ratings. Window: ${source.window}. Filter: ${source.filter}.`,
    ],
    [
      'Who grouped them',
      `${model}. One model, one pass over the text, not reviewed by a person. Check themes before opening tickets from them.`,
    ],
    [
      'What the model saw',
      'For each rating: the reasons ticked, the comment, the question and the answer, each cut to a few hundred characters.',
    ],
    [
      'Unclassified',
      analysis.unplaced > 0
        ? `${analysis.unplaced} ratings were not placed by the model and are listed under Unclassified.`
        : 'Every rating was placed in a theme.',
    ],
    ['Times', 'Date (UTC). The Langfuse screen shows local time.'],
    [
      'Sensitivity',
      'Contains customer questions and answers and was sent to the model named above. Share inside the company only.',
    ],
  ]);
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 130;
  styleHeader(sheet);
  wrapBody(sheet);
}

/** Writes feedback-themes-<stem>.xlsx: ranked themes, every rating under its theme, and how it was made. */
export async function writeThemesWorkbook(request: ThemesRequest): Promise<string> {
  if (!SAFE_STEM.test(request.stem) || request.stem.includes('..')) {
    throw new Error(`Export name "${request.stem}" is not a safe file name`);
  }
  await ensureOutDir(request.outDir);
  const path = join(request.outDir, `feedback-themes-${request.stem}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  summarySheet(workbook, request);
  rowsSheet(workbook, request);
  methodSheet(workbook, request);
  addConfigSheet(workbook, request.source.run, request.rows.length);
  await writePrivateWorkbook(workbook, path);
  return path;
}
