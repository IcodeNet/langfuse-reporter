import type { ExportRow } from '../presets/chat-feedback/build-rows.js';
import { padVisible, visibleWidth } from './ansi.js';
import { displayWidth, truncateToWidth } from './display-width.js';
import { stripControlCharacters } from './untrusted-text.js';

export interface TableColumn {
  key: string;
  header: string;
  /** The text shown for this row. Long text is cut to fit. */
  value: (row: ExportRow) => string;
  /** Columns with a higher priority number are dropped first when the terminal is narrow. */
  weight: number;
  /** Narrowest useful width; the column is dropped rather than shrunk below this. */
  min: number;
  /** Widest the column ever needs; spare room is given to columns that reach this last. */
  max: number;
}

const DAY = (row: ExportRow): string => new Date(row.created).toISOString().slice(0, 10);

/** Every column the table can show, in display order. */
export const TABLE_COLUMNS: readonly TableColumn[] = [
  { key: 'date', header: 'Date', value: DAY, weight: 0, min: 10, max: 10 },
  { key: 'rating', header: 'Rating', value: (row) => row.rating, weight: 0, min: 8, max: 8 },
  {
    key: 'reasons',
    header: 'Reasons',
    value: (row) => row.categories.join(', '),
    weight: 2,
    min: 10,
    max: 34,
  },
  { key: 'comment', header: 'Comment', value: (row) => row.comment, weight: 3, min: 12, max: 40 },
  {
    key: 'question',
    header: 'Rated question',
    value: (row) => row.ratedUser,
    weight: 1,
    min: 14,
    max: 44,
  },
  {
    key: 'answer',
    header: 'Rated answer',
    value: (row) => row.ratedAssistant,
    weight: 4,
    min: 14,
    max: 44,
  },
  { key: 'env', header: 'Env', value: (row) => row.environment, weight: 5, min: 8, max: 12 },
  {
    key: 'turn',
    header: 'Turn',
    value: (row) => `${row.turnNumber}/${row.conversationTurns}`,
    weight: 7,
    min: 5,
    max: 8,
  },
  { key: 'user', header: 'User', value: (row) => row.userId, weight: 8, min: 8, max: 14 },
];

export const DEFAULT_TABLE_COLUMNS = ['date', 'rating', 'reasons', 'comment', 'question'] as const;

const GAP = 2;

/** Removes terminal control sequences, then collapses line breaks and runs of spaces so one row is one line. */
function oneLine(text: string): string {
  return stripControlCharacters(text).replace(/\s+/g, ' ').trim();
}

function cut(text: string, width: number): string {
  return truncateToWidth(oneLine(text), width);
}

export function findColumn(key: string): TableColumn | undefined {
  return TABLE_COLUMNS.find((column) => column.key === key.toLowerCase());
}

/** Total characters a set of column widths occupies, including the gaps between them. */
function totalWidth(widths: readonly number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, widths.length - 1);
}

/** Drops the least important columns until the rest fit at their minimum widths. */
function fitColumns(chosen: readonly TableColumn[], available: number): TableColumn[] {
  const kept = [...chosen];
  while (kept.length > 1 && totalWidth(kept.map((column) => column.min)) > available) {
    const heaviest = kept.reduce((worst, column) =>
      column.weight >= worst.weight ? column : worst,
    );
    kept.splice(kept.indexOf(heaviest), 1);
  }
  return kept;
}

/** Starts every column at its minimum, then hands spare room to the one still furthest from its maximum. */
function allocateWidths(
  columns: readonly TableColumn[],
  rows: readonly ExportRow[],
  available: number,
): number[] {
  const wanted = columns.map((column) =>
    Math.min(
      column.max,
      Math.max(
        column.min,
        displayWidth(column.header),
        ...rows.map((row) => displayWidth(oneLine(column.value(row)))),
      ),
    ),
  );
  const widths = columns.map((column) => column.min);
  let spare = available - totalWidth(widths);
  while (spare > 0) {
    const grow = widths.findIndex((width, index) => width < (wanted[index] ?? width));
    if (grow === -1) break;
    widths[grow] = (widths[grow] ?? 0) + 1;
    spare--;
  }
  return widths;
}

export interface TableOptions {
  columns: readonly string[];
  /** Terminal width in characters. */
  width: number;
  /** Rows shown before "… N more". */
  limit: number;
  /** Wraps a header or a rating so colour can be applied; defaults to plain text. */
  decorate?: (kind: 'header' | 'positive' | 'negative', text: string) => string;
}

export interface RenderedTable {
  text: string;
  /** Column keys actually shown, after dropping any that did not fit. */
  shown: string[];
  /** Column keys left out because the terminal is too narrow. */
  dropped: string[];
  hiddenRows: number;
}

/** Renders matching rows as an aligned table that never exceeds the terminal width. */
export function renderTable(rows: readonly ExportRow[], options: TableOptions): RenderedTable {
  const decorate = options.decorate ?? ((_kind, text) => text);
  const chosen = options.columns.flatMap((key) => findColumn(key) ?? []);
  const columns = fitColumns(chosen, options.width);
  const dropped = chosen.filter((column) => !columns.includes(column)).map((column) => column.key);
  const visible = rows.slice(0, options.limit);
  const widths = allocateWidths(columns, visible, options.width);

  const cell = (column: TableColumn, row: ExportRow, width: number): string => {
    const text = padVisible(cut(column.value(row), width), width);
    return column.key === 'rating' ? decorate(row.rating, text) : text;
  };

  const header = columns
    .map((column, index) => decorate('header', padVisible(column.header, widths[index] ?? 0)))
    .join(' '.repeat(GAP));
  const rule = columns
    .map((_column, index) => '─'.repeat(widths[index] ?? 0))
    .join(' '.repeat(GAP));
  const body = visible.map((row) =>
    columns.map((column, index) => cell(column, row, widths[index] ?? 0)).join(' '.repeat(GAP)),
  );
  const hiddenRows = Math.max(0, rows.length - visible.length);
  const lines = [header, rule, ...body];
  if (visibleWidth(lines[0] ?? '') > options.width) lines.length = 0;
  return {
    text: lines.join('\n'),
    shown: columns.map((column) => column.key),
    dropped,
    hiddenRows,
  };
}
