import { describe, expect, it } from 'vitest';
import type { ExportRow } from '../presets/chat-feedback/build-rows.js';
import { buildReportLines, type ReportInfo } from './report-lines.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-1',
    sessionId: 's1',
    rating: 'negative',
    categories: ['off_topic'],
    comment: '',
    environment: 'uat-like',
    created: Date.parse('2026-10-14T10:11:31Z'),
    userId: 'u1',
    observationId: 'o1',
    turnNumber: 1,
    ratedUser: 'what is the best rate',
    ratedAssistant: 'It depends.',
    conversationTurns: 2,
    conversation: '',
    ...overrides,
  };
}

const INFO: ReportInfo = {
  projectName: 'acme-development',
  profileName: 'dev',
  window: '2026-10-13 → 2026-10-15',
  where: undefined,
  loadedCount: 5,
};

describe('buildReportLines', () => {
  it('should start with the project, profile, window, filter and counts when there are ratings', () => {
    const texts = buildReportLines([makeRow()], INFO, 80).map((line) => line.text);

    expect(texts.slice(0, 3)).toEqual([
      'Feedback report  ·  acme-development  (profile dev)',
      'Window 2026-10-13 → 2026-10-15   Filter: none, every rating in the window',
      '1 of 5 ratings: 0 positive, 1 negative',
    ]);
  });

  it('should give each rating a heading with the verdict, time, environment and reasons when the lines are built', () => {
    const lines = buildReportLines([makeRow()], INFO, 80);

    expect(lines.find((line) => line.kind === 'heading')?.text).toBe(
      '1/1  THUMBS DOWN  2026-10-14 10:11:31  uat-like  off_topic',
    );
  });

  it('should show the question and the answer with their labels when the lines are built', () => {
    const texts = buildReportLines([makeRow()], INFO, 80).map((line) => line.text);

    expect(texts).toEqual(
      expect.arrayContaining([
        '  Question',
        '    what is the best rate',
        '  Answer',
        '    It depends.',
      ]),
    );
  });

  it('should leave the comment out when the customer wrote none and show it when they did', () => {
    const without = buildReportLines([makeRow()], INFO, 80).map((line) => line.text);
    const withComment = buildReportLines([makeRow({ comment: 'too vague' })], INFO, 80).map(
      (line) => line.text,
    );

    expect([without.includes('  Comment'), withComment.includes('  Comment')]).toEqual([
      false,
      true,
    ]);
  });

  it('should wrap the answer when it is longer than the terminal is wide', () => {
    const longAnswer = 'word '.repeat(80);
    const lines = buildReportLines([makeRow({ ratedAssistant: longAnswer })], INFO, 60);

    expect(Math.max(...lines.map((line) => line.text.length))).toBeLessThanOrEqual(60);
  });

  it('should strip terminal control sequences when stored customer text contains them', () => {
    const hostile = `ok\u001b[2J\u001b]0;pwned\u0007 done`;
    const texts = buildReportLines([makeRow({ ratedAssistant: hostile })], INFO, 80).map(
      (line) => line.text,
    );

    expect(texts.some((text) => text.includes('\u001b'))).toBe(false);
  });

  it('should say no ratings match when the list is empty', () => {
    const texts = buildReportLines([], INFO, 80).map((line) => line.text);

    expect(texts.at(-1)).toBe('No ratings match. Nothing to show.');
  });

  it('should name the filter when one was used', () => {
    const texts = buildReportLines([makeRow()], { ...INFO, where: 'env = uat-like' }, 80).map(
      (line) => line.text,
    );

    expect(texts[1]).toContain('Filter: env = uat-like');
  });
});
