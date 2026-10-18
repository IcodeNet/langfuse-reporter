import type { ExportRow } from '../presets/chat-feedback/build-rows.js';
import { displayWidth, wrapWords } from '../ui/display-width.js';
import { stripControlCharacters } from '../ui/untrusted-text.js';
import type { PagerLine } from './pager-model.js';

export interface ReportInfo {
  projectName: string;
  profileName: string;
  /** "2026-10-13 → 2026-10-15", as the banner shows it. */
  window: string;
  /** The filter, or undefined for every rating. */
  where: string | undefined;
  /** Rows the filter removed from the loaded set. */
  loadedCount: number;
}

const INDENT = '    ';

function day(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');
}

/** Customer, model and Langfuse text is cleaned first so stored text cannot move the cursor or forge lines. */
function clean(text: string): string {
  return stripControlCharacters(text).replace(/\r/g, '');
}

/** A paragraph as wrapped body lines; blank lines in the source stay blank. */
function paragraph(label: string, text: string, width: number): PagerLine[] {
  const body = clean(text).trim();
  const out: PagerLine[] = [{ text: `  ${label}`, kind: 'label' }];
  if (body === '') return [...out, { text: `${INDENT}(empty)`, kind: 'body' }];
  for (const block of body.split('\n')) {
    const wrapped =
      block.trim() === '' ? [''] : wrapWords(block, Math.max(20, width - INDENT.length));
    for (const line of wrapped)
      out.push({ text: line === '' ? '' : `${INDENT}${line}`, kind: 'body' });
  }
  return out;
}

function headingFor(row: ExportRow, position: number, total: number): PagerLine {
  const verdict = row.rating === 'positive' ? 'THUMBS UP' : 'THUMBS DOWN';
  const reasons = row.categories.length > 0 ? `  ${row.categories.join(', ')}` : '';
  return {
    text: `${position}/${total}  ${verdict}  ${day(row.created)}  ${row.environment}${reasons}`,
    kind: 'heading',
    tone: row.rating,
  };
}

interface RatingPlace {
  position: number;
  total: number;
  width: number;
}

function ratingLines(row: ExportRow, { position, total, width }: RatingPlace): PagerLine[] {
  const where = `turn ${row.turnNumber} of ${row.conversationTurns}  ·  trace ${row.traceId}`;
  return [
    headingFor(row, position, total),
    { text: `  ${where}`, kind: 'label' },
    ...(row.comment.trim() === '' ? [] : paragraph('Comment', row.comment, width)),
    ...paragraph('Question', row.ratedUser, width),
    ...paragraph('Answer', row.ratedAssistant, width),
    { text: '', kind: 'body' },
  ];
}

/** Wraps a line that is wider than the terminal, keeping its indent and its look on every piece. */
function fitWidth(line: PagerLine, width: number): PagerLine[] {
  if (displayWidth(line.text) <= width) return [line];
  const indent = /^\s*/.exec(line.text)?.[0] ?? '';
  const pieces = wrapWords(line.text.trim(), Math.max(10, width - indent.length));
  return pieces.map((piece) => ({ ...line, text: `${indent}${piece}` }));
}

/** Everything the pager shows: a title block, then one block per rating, newest first as loaded. */
export function buildReportLines(
  rows: readonly ExportRow[],
  info: ReportInfo,
  width: number,
): PagerLine[] {
  const positive = rows.filter((row) => row.rating === 'positive').length;
  const filter = info.where ? info.where : 'none, every rating in the window';
  const title: PagerLine[] = [
    {
      text: `Feedback report  ·  ${info.projectName}  (profile ${info.profileName})`,
      kind: 'title',
    },
    { text: `Window ${info.window}   Filter: ${filter}`, kind: 'label' },
    {
      text: `${rows.length} of ${info.loadedCount} ratings: ${positive} positive, ${rows.length - positive} negative`,
      kind: 'label',
    },
    { text: '─'.repeat(Math.max(10, Math.min(width, 100))), kind: 'rule' },
    { text: '', kind: 'body' },
  ];
  const all =
    rows.length === 0
      ? [...title, { text: 'No ratings match. Nothing to show.', kind: 'body' as const }]
      : [
          ...title,
          ...rows.flatMap((row, index) =>
            ratingLines(row, { position: index + 1, total: rows.length, width }),
          ),
        ];
  return all.flatMap((line) => fitWidth(line, width));
}
