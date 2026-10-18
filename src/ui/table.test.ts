import { describe, expect, it } from 'vitest';
import type { ExportRow } from '../presets/chat-feedback/build-rows.js';
import { stripAnsi, visibleWidth } from './ansi.js';
import { DEFAULT_TABLE_COLUMNS, renderTable } from './table.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 't1',
    sessionId: 's1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: 'Not very proactive',
    environment: 'uat-like',
    created: Date.parse('2026-09-15T08:58:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    turnNumber: 7,
    ratedUser: 'This is ridiculous, you showed me a whole list',
    ratedAssistant: 'I understand you wanted a simple answer',
    conversationTurns: 7,
    conversation: '',
    ...overrides,
  };
}

const options = { columns: DEFAULT_TABLE_COLUMNS, width: 120, limit: 20 };

describe('renderTable', () => {
  it('should show the chosen columns as headers when the terminal is wide', () => {
    const { text } = renderTable([makeRow()], options);

    expect(text.split('\n')[0]).toMatch(/^Date\s+Rating\s+Reasons\s+Comment\s+Rated question/);
  });

  it('should print one line per row plus a header and a rule when a table is drawn', () => {
    const { text } = renderTable([makeRow(), makeRow()], options);

    expect(text.split('\n')).toHaveLength(4);
  });

  it('should never exceed the terminal width when the text is long', () => {
    const long = makeRow({ comment: 'x'.repeat(500), ratedUser: 'y'.repeat(500) });

    const { text } = renderTable([long], { ...options, width: 80 });

    expect(Math.max(...text.split('\n').map(visibleWidth))).toBeLessThanOrEqual(80);
  });

  it('should end cut text with an ellipsis when it does not fit', () => {
    const { text } = renderTable([makeRow({ comment: 'x'.repeat(500) })], {
      ...options,
      width: 80,
    });

    expect(text).toContain('…');
  });

  it('should keep every row on one line when text contains line breaks', () => {
    const { text } = renderTable([makeRow({ comment: 'first\nsecond\n\nthird' })], options);

    expect(text.split('\n')).toHaveLength(3);
  });

  it('should drop the least important columns first when the terminal is narrow', () => {
    const { shown, dropped } = renderTable([makeRow()], { ...options, width: 40 });

    expect(shown).toContain('date');
    expect(dropped).toContain('comment');
  });

  it('should still show the date and rating when the terminal is very narrow', () => {
    const { shown } = renderTable([makeRow()], { ...options, width: 22 });

    expect(shown).toEqual(['date', 'rating']);
  });

  it('should report how many rows were left out when there are more than the limit', () => {
    const { hiddenRows } = renderTable([makeRow(), makeRow(), makeRow()], { ...options, limit: 2 });

    expect(hiddenRows).toBe(1);
  });

  it('should ignore a column name it does not know when choosing columns', () => {
    const { shown } = renderTable([makeRow()], { ...options, columns: ['date', 'nonsense'] });

    expect(shown).toEqual(['date']);
  });

  it('should colour the rating cell only when a decorator is given', () => {
    const { text } = renderTable([makeRow()], {
      ...options,
      decorate: (kind, value) => (kind === 'negative' ? `<${value}>` : value),
    });

    expect(stripAnsi(text)).toContain('<negative');
  });

  it('should show the turn as position over total when the turn is known', () => {
    const { text } = renderTable([makeRow()], { ...options, columns: ['turn'], width: 40 });

    expect(text).toContain('7/7');
  });

  it('should strip terminal control sequences when customer text is drawn in the table', () => {
    const hostile = `${String.fromCharCode(27)}[2J${String.fromCharCode(27)}]0;pwned${String.fromCharCode(7)}clear`;
    const { text } = renderTable([makeRow({ comment: hostile })], {
      columns: ['comment'],
      width: 40,
      limit: 5,
    });

    expect(text).toContain('clear');
    expect(text).not.toContain(String.fromCharCode(27));
    expect(text).not.toContain('pwned');
  });

  it('should keep every line within the terminal width when the text is wide or has emoji', () => {
    const { text } = renderTable(
      [
        makeRow({
          comment: '日本語のとても長いコメントです📊📊📊📊',
          ratedUser: '👨‍👩‍👧 family question',
        }),
      ],
      { columns: ['comment', 'question'], width: 40, limit: 5 },
    );

    expect(Math.max(...text.split('\n').map((line) => visibleWidth(line)))).toBeLessThanOrEqual(40);
  });
});
