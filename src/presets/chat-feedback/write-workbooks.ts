import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { ensureOutDir } from '../../output/check-out-dir.js';
import { autoFit } from '../../output/auto-fit.js';
import { addConfigSheet } from './config-sheet.js';
import type { RunInfo } from '../../output/run-info.js';
import { writePrivateWorkbook } from '../../output/private-file.js';
import type { Conventions } from '../../config/config-schema.js';
import type { LangfuseProject } from '../../langfuse/langfuse-client.js';
import type { ExportRow } from './build-rows.js';

/** Where the rows came from and what was asked; drives the trace links and the method sheet. */
export interface WorkbookSource {
  project: LangfuseProject;
  baseUrl: string;
  /** The words and names the files show, from the config. */
  labels: Pick<Conventions, 'assistantName' | 'passLabel' | 'failLabel'>;
  /** The date window in plain words, for the method sheet. */
  window: string;
  /** The filter applied, or "none". */
  filter: string;
  /** How the report was made; drives the Config and filters sheet. */
  run: RunInfo;
}

type CellContent = string | number | ExcelJS.CellHyperlinkValue;

interface Column {
  /** Fixed text, or text that depends on the config (the assistant's name). */
  header: string | ((source: WorkbookSource) => string);
  width: number;
  value: (row: ExportRow, source: WorkbookSource) => CellContent;
}

/** Excel rejects cell text over 32,767 characters. */
const MAX_CELL_CHARS = 32_000;

const HEADER_FILL = 'FF1F3864';
const PASS_FILL = 'FFD9EAD3';
const FAIL_FILL = 'FFF8D7DA';
const LINK_BLUE = 'FF0563C1';

/** Opens the trace with the rated answer selected, as the Langfuse screen does. */
export function turnUrl({ project, baseUrl }: WorkbookSource, row: ExportRow): string {
  const path = `/project/${encodeURIComponent(project.id)}/traces/${encodeURIComponent(row.traceId)}`;
  const url = new URL(path, baseUrl);
  url.searchParams.set('observation', row.observationId);
  return url.href;
}

function clip(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…[truncated]` : text;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');
}

/** Same leading columns as the CSV-based workbook, so both read alike. */
const COLUMNS: Column[] = [
  { header: 'Date (UTC)', width: 19, value: (row) => formatDate(row.created) },
  {
    header: 'Result',
    width: 8,
    value: (row, source) =>
      row.rating === 'positive' ? source.labels.passLabel : source.labels.failLabel,
  },
  { header: 'Categories ticked', width: 34, value: (row) => row.categories.join(', ') },
  { header: 'Comment', width: 60, value: (row) => clip(row.comment) },
  { header: 'Question (customer)', width: 60, value: (row) => clip(row.ratedUser) },
  {
    header: (source) => `Answer (${source.labels.assistantName})`,
    width: 80,
    value: (row) => clip(row.ratedAssistant),
  },
  { header: 'Turn #', width: 7, value: (row) => row.turnNumber },
  { header: 'Turns in conversation', width: 11, value: (row) => row.conversationTurns },
  {
    header: 'Trace link',
    width: 11,
    value: (row, source) => ({ text: 'Open', hyperlink: turnUrl(source, row) }),
  },
  { header: 'Trace id', width: 34, value: (row) => row.traceId },
  { header: 'Conversation id', width: 38, value: (row) => row.sessionId },
  { header: 'Rated turn id', width: 20, value: (row) => row.observationId },
  { header: 'Project', width: 24, value: (_row, source) => source.project.name },
  { header: 'Environment', width: 12, value: (row) => row.environment },
  { header: 'User', width: 14, value: (row) => row.userId },
  { header: 'Full conversation', width: 100, value: (row) => clip(row.conversation) },
];

function columnNumber(header: string): number {
  return COLUMNS.findIndex((column) => column.header === header) + 1;
}

/** Long answers and conversations wrap at this width instead of making the sheet wider than a screen. */
const FEEDBACK_MAX_WIDTH = 70;

const DETAIL_MAX_WIDTH = 110;

const RESULT_COLUMN = columnNumber('Result');
const LINK_COLUMN = columnNumber('Trace link');

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(HEADER_FILL);
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
}

function addFeedbackRow(sheet: ExcelJS.Worksheet, row: ExportRow, source: WorkbookSource): void {
  const added = sheet.addRow(COLUMNS.map((column) => column.value(row, source)));
  added.eachCell({ includeEmpty: true }, (cell) => {
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
  added.getCell(RESULT_COLUMN).fill = fill(row.rating === 'positive' ? PASS_FILL : FAIL_FILL);
  added.getCell(LINK_COLUMN).font = { color: { argb: LINK_BLUE }, underline: true };
}

function methodRows(rows: ExportRow[], source: WorkbookSource): Array<[string, string]> {
  return [
    [
      'What this is',
      'One row per rating: the thumb, the question and answer it was given on, and the reasons ticked.',
    ],
    [
      'Source',
      `Langfuse project ${source.project.name} at ${source.baseUrl}. Each rating is a score on the chat-turn it rated; question and answer are that turn's input and output.`,
    ],
    ['Date window', source.window],
    ['Filter', source.filter],
    ['Rows', String(rows.length)],
    [
      'Turn #',
      "Position of the rated answer among the conversation's answers, oldest first, so it can be found in the trace.",
    ],
    ['Trace link', 'Opens the trace with the rated answer selected.'],
    ['Times', 'Date (UTC). The Langfuse screen shows local time, one hour later in summer.'],
    ['Sensitivity', 'Contains customer questions and answers. Share inside the company only.'],
  ];
}

function addMethodSheet(
  workbook: ExcelJS.Workbook,
  rows: ExportRow[],
  source: WorkbookSource,
): void {
  const sheet = workbook.addWorksheet('Method and caveats');
  sheet.addRow(['Item', 'Detail']);
  for (const line of methodRows(rows, source)) sheet.addRow(line);
  styleHeader(sheet);
  sheet.eachRow((excelRow, index) => {
    if (index === 1) return;
    excelRow.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });
  autoFit(sheet, { maxWidth: DETAIL_MAX_WIDTH });
}

interface SheetRequest {
  path: string;
  rows: ExportRow[];
  source: WorkbookSource;
}

async function writeWorkbook({ path, rows, source }: SheetRequest): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Feedback per turn', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });
  sheet.addRow(
    COLUMNS.map((column) =>
      typeof column.header === 'function' ? column.header(source) : column.header,
    ),
  );
  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });
  styleHeader(sheet);
  for (const row of rows) addFeedbackRow(sheet, row, source);
  autoFit(sheet, { maxWidth: FEEDBACK_MAX_WIDTH });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  addMethodSheet(workbook, rows, source);
  addConfigSheet(workbook, source.run, rows.length);
  await writePrivateWorkbook(workbook, path);
}

export interface ExportPaths {
  /** Absent when no positive rating was selected: an empty file would only look like a failed export. */
  positive?: string;
  /** Absent when no negative rating was selected. */
  negative?: string;
  /** True when an earlier export of the same name was overwritten. */
  replaced: boolean;
}

const SAFE_STEM = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;

/** Refuses a name that could point outside the export folder. */
export function assertSafeStem(stem: string): void {
  if (!SAFE_STEM.test(stem) || stem.includes('..')) {
    throw new Error(`Export name "${stem}" is not a safe file name`);
  }
}

export interface SplitWorkbooksRequest {
  outDir: string;
  stem: string;
  rows: ExportRow[];
  source: WorkbookSource;
}

/** Writes feedback-positive-<stem>.xlsx and feedback-negative-<stem>.xlsx, skipping a side that has no rows. */
export async function writeSplitWorkbooks({
  outDir,
  stem,
  rows,
  source,
}: SplitWorkbooksRequest): Promise<ExportPaths> {
  assertSafeStem(stem);
  await ensureOutDir(outDir);
  const written: ExportPaths = { replaced: false };
  for (const side of ['positive', 'negative'] as const) {
    const path = join(outDir, `feedback-${side}-${stem}.xlsx`);
    const sideRows = rows.filter((row) => row.rating === side);
    const existed = existsSync(path);
    if (sideRows.length === 0) {
      // A leftover from an earlier run of this same query would show old ratings as current.
      if (existed) await rm(path);
      written.replaced ||= existed;
      continue;
    }
    written.replaced ||= existed;
    await writeWorkbook({ path, rows: sideRows, source });
    written[side] = path;
  }
  return written;
}
