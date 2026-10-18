import ExcelJS from 'exceljs';
import { readSmallBinaryFile } from './read-report-file.js';
import type { ReportRow } from './compare-rows.js';

/** The setup a report was made with, read from its Config and filters sheet. */
export type ReportSetup = Readonly<Record<string, string>>;

export interface ReportFile {
  /** File name only, for the summary. */
  name: string;
  rows: ReportRow[];
  setup: ReportSetup;
  /** Sheets the file has, so a wrong file can be named in the error. */
  sheets: string[];
}

const FEEDBACK_SHEET = 'Feedback per turn';
const CONFIG_SHEET = 'Config and filters';

/** Header text of the columns this reader needs; the answer header holds the assistant's name. */
const HEADERS = {
  date: 'Date (UTC)',
  result: 'Result',
  reasons: 'Categories ticked',
  comment: 'Comment',
  question: 'Question (customer)',
} as const;

/** ExcelJS wants an ArrayBuffer; a Buffer's bytes are copied into exactly one. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function cellText(cell: ExcelJS.Cell): string {
  return cell.text;
}

function cellLink(cell: ExcelJS.Cell): ReportRow['link'] {
  const value = cell.value;
  if (value && typeof value === 'object' && 'hyperlink' in value) {
    return { text: value.text || 'Open', hyperlink: value.hyperlink };
  }
  return undefined;
}

function columnIndex(headers: readonly string[], wanted: string): number {
  return headers.findIndex((header) => header === wanted);
}

/** Reads the data rows of a report; Pass/Fail labels from the setup tell which rows are positive. */
function readRows(sheet: ExcelJS.Worksheet, passLabel: string): ReportRow[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = cellText(cell);
  });
  const at = (name: string): number => columnIndex(headers, name) + 1;
  const answerColumn = headers.findIndex((header) => header.startsWith('Answer (')) + 1;
  const linkColumn = at('Trace link');
  const rows: ReportRow[] = [];
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const question = cellText(row.getCell(at(HEADERS.question)));
    if (question === '' && cellText(row.getCell(at(HEADERS.date))) === '') continue;
    rows.push({
      question,
      result: cellText(row.getCell(at(HEADERS.result))) === passLabel ? 'positive' : 'negative',
      reasons: cellText(row.getCell(at(HEADERS.reasons))),
      comment: cellText(row.getCell(at(HEADERS.comment))),
      answer: answerColumn > 0 ? cellText(row.getCell(answerColumn)) : '',
      date: cellText(row.getCell(at(HEADERS.date))),
      link: linkColumn > 0 ? cellLink(row.getCell(linkColumn)) : undefined,
    });
  }
  return rows;
}

function readSetup(sheet: ExcelJS.Worksheet | undefined): ReportSetup {
  const setup: Record<string, string> = {};
  sheet?.eachRow((row, index) => {
    if (index > 1) setup[cellText(row.getCell(1))] = cellText(row.getCell(2));
  });
  return setup;
}

/** The label the report used for a thumbs-up, read from its setup; the default when it is not there. */
function passLabelOf(setup: ReportSetup): string {
  const labels = setup['Pass / Fail labels'];
  return labels?.split(' / ')[0] ?? 'Pass';
}

/**
 * Reads a report written by `feedback export` or `save`. Says what is wrong when the file is not
 * one of those, so a mix-up of files is caught before anything is compared.
 */
export async function readReportFile(path: string): Promise<ReportFile> {
  const bytes = await readSmallBinaryFile(path);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(toArrayBuffer(bytes));
  } catch (err) {
    throw new Error(
      `${path} is not an Excel file I can read (${err instanceof Error ? err.message : String(err)})`,
      { cause: err },
    );
  }
  const sheets = workbook.worksheets.map((sheet) => sheet.name);
  const feedback = workbook.getWorksheet(FEEDBACK_SHEET);
  if (!feedback) {
    throw new Error(
      `${path} has no "${FEEDBACK_SHEET}" sheet (it has: ${sheets.join(', ')}). Use a file written by "feedback export" or "save".`,
    );
  }
  const setup = readSetup(workbook.getWorksheet(CONFIG_SHEET));
  const name = path.split('/').at(-1) ?? path;
  return { name, rows: readRows(feedback, passLabelOf(setup)), setup, sheets };
}
