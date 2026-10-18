import { brand } from '../brand/brand.js';
import ExcelJS from 'exceljs';
import { writePrivateWorkbook } from '../output/private-file.js';
import { autoFit } from '../output/auto-fit.js';
import { countVerdicts, VERDICT_ORDER, type ComparedRow, type ReportRow } from './compare-rows.js';
import type { ReportFile } from './read-report.js';

const HEADER_FILL = 'FF1F3864';
const GOOD_FILL = 'FFD9EAD3';
const BAD_FILL = 'FFF8D7DA';
const NEUTRAL_FILL = 'FFFFF2CC';
const MAX_CELL_CHARS = 32_000;

/** Setting names whose values differ between two reports, so a changed setup is visible at a glance. */
const COMPARED_SETTINGS: readonly string[] = [
  'Profile',
  'Langfuse address',
  'Date window from (UTC)',
  'Date window to (UTC, not included)',
  'Filter',
  'Rows in this file',
  'Turn name',
  'Rating score',
  `${brand.name} CLI version`,
];

function clip(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…[truncated]` : text;
}

/** Pass or Fail for a row, or the note when that report did not have the question. */
function resultText(row: ReportRow | undefined, missing: string): string {
  if (!row) return missing;
  return row.result === 'positive' ? 'Pass' : 'Fail';
}

function fillFor(verdict: ComparedRow['verdict']): string {
  if (
    verdict.startsWith('improved') ||
    verdict === 'new positive' ||
    verdict === 'still positive'
  ) {
    return GOOD_FILL;
  }
  if (verdict === 'still negative' || verdict === 'got worse' || verdict === 'new problem') {
    return BAD_FILL;
  }
  return NEUTRAL_FILL;
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
}

function wrapBody(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });
}

/** A copy of a report's rating rows as its own sheet, so the comparison keeps both originals. */
function addRatingsSheet(workbook: ExcelJS.Workbook, name: string, file: ReportFile): void {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow([
    'Date (UTC)',
    'Result',
    'Categories ticked',
    'Comment',
    'Question',
    'Answer',
    'Trace link',
  ]);
  for (const row of file.rows) {
    sheet.addRow([
      row.date,
      row.result === 'positive' ? 'Pass' : 'Fail',
      row.reasons,
      clip(row.comment),
      clip(row.question),
      clip(row.answer),
      row.link ?? '',
    ]);
  }
  styleHeader(sheet);
  wrapBody(sheet);
  autoFit(sheet, { maxWidth: 70 });
}

function summaryLines(
  before: ReportFile,
  after: ReportFile,
  rows: readonly ComparedRow[],
): Array<[string, string]> {
  const counts = countVerdicts(rows);
  const negatives = (file: ReportFile): number =>
    file.rows.filter((row) => row.result === 'negative').length;
  const lines: Array<[string, string]> = [
    [
      'Before (sheet 1)',
      `${before.name}: ${before.rows.length} ratings, ${negatives(before)} negative`,
    ],
    [
      'After (sheet 2)',
      `${after.name}: ${after.rows.length} ratings, ${negatives(after)} negative`,
    ],
  ];
  for (const verdict of VERDICT_ORDER) {
    const count = counts.get(verdict);
    if (count) lines.push([verdict, String(count)]);
  }
  lines.push([
    'Read this carefully',
    '"improved: not negative this time" can also mean nobody rated that question again. Check the setups below before you call it a fix.',
  ]);
  return lines;
}

function setupLines(
  before: ReportFile,
  after: ReportFile,
): Array<[string, string, string, string]> {
  return COMPARED_SETTINGS.map((setting) => {
    const left = before.setup[setting] ?? '(not in the file)';
    const right = after.setup[setting] ?? '(not in the file)';
    return [setting, left, right, left === right ? 'same' : 'DIFFERENT'];
  });
}

/**
 * Writes one workbook with three sheets: the first report, the second report, and the comparison
 * (summary, both setups side by side, then one row per question with its verdict).
 */
export interface ComparisonRequest {
  path: string;
  before: ReportFile;
  after: ReportFile;
  rows: readonly ComparedRow[];
}

export async function writeComparison({
  path,
  before,
  after,
  rows,
}: ComparisonRequest): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  addRatingsSheet(workbook, '1 Before', before);
  addRatingsSheet(workbook, '2 After', after);

  const sheet = workbook.addWorksheet('3 Comparison', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(['Summary', 'Value']);
  for (const line of summaryLines(before, after, rows)) sheet.addRow(line);
  sheet.addRow([]);
  const setupHeader = sheet.addRow(['Setup', 'Before', 'After', 'Same?']);
  for (const line of setupLines(before, after)) {
    const added = sheet.addRow(line);
    if (line[3] === 'DIFFERENT')
      added.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAD_FILL } };
  }
  sheet.addRow([]);
  const detailHeader = sheet.addRow([
    'Verdict',
    'Question',
    'Before: result',
    'Before: answer',
    'After: result',
    'After: answer',
    'Before: link',
    'After: link',
  ]);
  const order = new Map(VERDICT_ORDER.map((verdict, index) => [verdict, index]));
  const sorted = [...rows].sort(
    (a, b) => (order.get(a.verdict) ?? 99) - (order.get(b.verdict) ?? 99),
  );
  for (const row of sorted) {
    const added = sheet.addRow([
      row.verdict,
      clip(row.question),
      resultText(row.before, '(not in before)'),
      clip(row.before?.answer ?? ''),
      resultText(row.after, '(not in after)'),
      clip(row.after?.answer ?? ''),
      row.before?.link ?? '',
      row.after?.link ?? '',
    ]);
    added.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fillFor(row.verdict) },
    };
  }
  for (const header of [sheet.getRow(1), setupHeader, detailHeader]) {
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });
  }
  wrapBody(sheet);
  autoFit(sheet, { maxWidth: 60 });
  await writePrivateWorkbook(workbook, path);
}
