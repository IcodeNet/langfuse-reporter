import { describe, expect, it } from 'vitest';
import type { ExportRow } from './build-rows.js';
import { formatRows, isOutputFormat, rowsToCsv, rowsToJson } from './format-rows.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-1',
    sessionId: 'session-1',
    observationId: 'obs-1',
    rating: 'negative',
    categories: ['other_issue', 'too_slow'],
    comment: 'did not help',
    environment: 'uat-like',
    created: Date.parse('2026-10-14T10:00:00Z'),
    userId: 'U-SECRET-1',
    turnNumber: 2,
    ratedUser: 'what is the best rate',
    ratedAssistant: 'It depends.',
    conversationTurns: 2,
    conversation: 'the whole conversation text',
    ...overrides,
  };
}

describe('rowsToJson', () => {
  it('should give one object per rating with the columns a script needs when the rows are written as JSON', () => {
    expect(JSON.parse(rowsToJson([makeRow()]))).toEqual([
      {
        created: '2026-10-14T10:00:00.000Z',
        rating: 'negative',
        reasons: ['other_issue', 'too_slow'],
        comment: 'did not help',
        environment: 'uat-like',
        traceId: 'trace-1',
        sessionId: 'session-1',
        observationId: 'obs-1',
        turnNumber: 2,
        question: 'what is the best rate',
        answer: 'It depends.',
      },
    ]);
  });

  it('should leave the user id and the whole conversation out when the rows are written as JSON', () => {
    const text = rowsToJson([makeRow()]);

    expect([text.includes('U-SECRET-1'), text.includes('the whole conversation text')]).toEqual([
      false,
      false,
    ]);
  });

  it('should give an empty list when there are no ratings', () => {
    expect(rowsToJson([])).toBe('[]\n');
  });

  it('should drop escape sequences when the customer text contains them', () => {
    const text = rowsToJson([makeRow({ comment: 'hi \x1b]0;pwned\x07 there' })]);

    expect(text.includes('\x1b')).toBe(false);
  });
});

describe('rowsToCsv', () => {
  it('should start with a header line naming the columns when the rows are written as CSV', () => {
    expect(rowsToCsv([]).split('\n')[0]).toBe(
      'created,rating,reasons,comment,environment,traceId,sessionId,observationId,turnNumber,question,answer',
    );
  });

  it('should write one line per rating when the rows are written as CSV', () => {
    expect(rowsToCsv([makeRow()]).split('\n')[1]).toBe(
      '2026-10-14T10:00:00.000Z,negative,other_issue; too_slow,did not help,uat-like,trace-1,session-1,obs-1,2,what is the best rate,It depends.',
    );
  });

  it('should quote the cell when it has a comma, a quote or a line break', () => {
    const csv = rowsToCsv([makeRow({ comment: 'a, "b"\nc' })]);

    expect(csv).toContain('"a, ""b""\nc"');
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx'])(
    'should put a quote in front of the cell when %j would run as a formula in a spreadsheet',
    (comment) => {
      expect(rowsToCsv([makeRow({ comment })]).split('\n')[1]).toContain(`,'${comment},`);
    },
  );

  it('should leave the user id out when the rows are written as CSV', () => {
    expect(rowsToCsv([makeRow()]).includes('U-SECRET-1')).toBe(false);
  });
});

describe('formatRows and isOutputFormat', () => {
  it('should pick the writer when the format name is given', () => {
    expect([formatRows([], 'json'), formatRows([], 'csv').startsWith('created,')]).toEqual([
      '[]\n',
      true,
    ]);
  });

  it.each([
    ['json', true],
    ['csv', true],
    ['xml', false],
    ['', false],
    ['JSON', false],
  ])('should judge the format name %j as %s when it is checked', (value, expected) => {
    expect(isOutputFormat(value)).toBe(expected);
  });
});
