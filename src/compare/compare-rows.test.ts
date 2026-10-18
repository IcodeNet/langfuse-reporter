import { describe, expect, it } from 'vitest';
import {
  compareRows,
  countVerdicts,
  questionKey,
  type ReportRow,
  type Verdict,
} from './compare-rows.js';

function makeRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    question: 'what is the best rate',
    result: 'negative',
    reasons: 'other_issue',
    comment: '',
    answer: 'It depends.',
    date: '2026-10-14 10:11:31',
    link: undefined,
    ...overrides,
  };
}

const negative = (question: string): ReportRow => makeRow({ question, result: 'negative' });
const positive = (question: string): ReportRow => makeRow({ question, result: 'positive' });

function verdicts(before: ReportRow[], after: ReportRow[]): Verdict[] {
  return compareRows(before, after).map((row) => row.verdict);
}

describe('questionKey', () => {
  it('should ignore case, outer spaces and runs of spaces when keys are compared', () => {
    expect(questionKey('  What   is THE best\nrate ')).toBe('what is the best rate');
  });
});

describe('compareRows verdicts', () => {
  it('should say still negative when a question is negative in both reports', () => {
    expect(verdicts([negative('a')], [negative('a')])).toEqual(['still negative']);
  });

  it('should say improved and now positive when a negative question is positive later', () => {
    expect(verdicts([negative('a')], [positive('a')])).toEqual(['improved: now positive']);
  });

  it('should say not negative this time when a negative question is missing later', () => {
    expect(verdicts([negative('a')], [])).toEqual(['improved: not negative this time']);
  });

  it('should say got worse when a positive question is negative later', () => {
    expect(verdicts([positive('a')], [negative('a')])).toEqual(['got worse']);
  });

  it('should say new problem when a negative question was not in the first report', () => {
    expect(verdicts([], [negative('a')])).toEqual(['new problem']);
  });

  it('should say still positive, no longer rated positive or new positive when the cases are positive', () => {
    expect(verdicts([positive('a'), positive('b')], [positive('a'), positive('c')])).toEqual([
      'still positive',
      'no longer rated positive',
      'new positive',
    ]);
  });
});

describe('compareRows matching', () => {
  it('should match the questions when they differ only in case and spacing', () => {
    expect(verdicts([negative('What is  the RATE')], [positive('what is the rate')])).toEqual([
      'improved: now positive',
    ]);
  });

  it('should match the first with the first and the second with the second when a question repeats', () => {
    const rows = compareRows([negative('a'), negative('a')], [positive('a'), negative('a')]);

    expect(rows.map((row) => row.verdict)).toEqual(['improved: now positive', 'still negative']);
  });

  it('should treat the extra repeat as new when the second report asks the question more often', () => {
    expect(verdicts([negative('a')], [negative('a'), negative('a')])).toEqual([
      'still negative',
      'new problem',
    ]);
  });

  it('should keep the order of the first report and put new rows after it when the reports are compared', () => {
    const rows = compareRows([negative('b'), negative('a')], [negative('z'), negative('a')]);

    expect(rows.map((row) => row.question)).toEqual(['b', 'a', 'z']);
  });

  it('should return nothing when both reports are empty', () => {
    expect(compareRows([], [])).toEqual([]);
  });
});

describe('countVerdicts', () => {
  it('should count how many rows got each verdict when the verdicts are summed', () => {
    const counts = countVerdicts(
      compareRows([negative('a'), negative('b'), negative('c')], [negative('a'), positive('b')]),
    );

    expect(Object.fromEntries(counts)).toEqual({
      'still negative': 1,
      'improved: now positive': 1,
      'improved: not negative this time': 1,
    });
  });
});

describe('compareRows with many unmatched rows', () => {
  it('should list every new row in the order of the second report when none of them match', () => {
    const after = Array.from({ length: 3 }, (_unused, index) => negative(`new question ${index}`));

    const compared = compareRows([], after);

    expect(compared.map((row) => row.question)).toEqual([
      'new question 0',
      'new question 1',
      'new question 2',
    ]);
  });
});
