import type { ExportRow } from './build-rows.js';
import { stripControlCharacters } from '../../ui/untrusted-text.js';

export const OUTPUT_FORMATS = ['json', 'csv'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const EVAL_REPORT_FORMAT = 'eval-report';
export type ExportFormat = OutputFormat | typeof EVAL_REPORT_FORMAT;

/** The columns a script gets. The user id and the whole conversation are left out on purpose. */
const COLUMNS = [
  'created',
  'rating',
  'reasons',
  'comment',
  'environment',
  'traceId',
  'sessionId',
  'observationId',
  'turnNumber',
  'question',
  'answer',
] as const;

type Column = (typeof COLUMNS)[number];
type Record_ = Record<Column, string | number | string[]>;

function toRecord(row: ExportRow): Record_ {
  return {
    created: new Date(row.created).toISOString(),
    rating: row.rating,
    reasons: row.categories.map((reason) => stripControlCharacters(reason)),
    comment: stripControlCharacters(row.comment),
    environment: stripControlCharacters(row.environment),
    traceId: row.traceId,
    sessionId: row.sessionId,
    observationId: row.observationId,
    turnNumber: row.turnNumber,
    question: stripControlCharacters(row.ratedUser),
    answer: stripControlCharacters(row.ratedAssistant),
  };
}

/** One JSON array of objects, two-space indented; reasons stay a list. */
export function rowsToJson(rows: readonly ExportRow[]): string {
  return `${JSON.stringify(rows.map(toRecord), null, 2)}\n`;
}

/** A spreadsheet runs a cell that starts with one of these as a formula, so a quote goes in front. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number | string[]): string {
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** A header line and one line per rating; text with commas, quotes or line breaks is quoted. */
export function rowsToCsv(rows: readonly ExportRow[]): string {
  const lines = rows.map((row) => {
    const record = toRecord(row);
    return COLUMNS.map((column) => csvCell(record[column])).join(',');
  });
  return `${[COLUMNS.join(','), ...lines].join('\n')}\n`;
}

export function formatRows(rows: readonly ExportRow[], format: OutputFormat): string {
  return format === 'json' ? rowsToJson(rows) : rowsToCsv(rows);
}

/** True for a format name the command accepts. */
export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

/** True for a format `feedback export` accepts: the two data formats and the eval-report file. */
export function isExportFormat(value: string): value is ExportFormat {
  return value === EVAL_REPORT_FORMAT || isOutputFormat(value);
}
