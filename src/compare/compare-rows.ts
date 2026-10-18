/** One rating as read back from a report file. */
export interface ReportRow {
  question: string;
  result: 'positive' | 'negative';
  reasons: string;
  comment: string;
  answer: string;
  date: string;
  /** Link to the rated turn in Langfuse, when the file has one. */
  link: { text: string; hyperlink: string } | undefined;
}

export type Verdict =
  | 'improved: now positive'
  | 'improved: not negative this time'
  | 'still negative'
  | 'got worse'
  | 'new problem'
  | 'still positive'
  | 'no longer rated positive'
  | 'new positive';

/** Worst first, so the summary and the sheet read from what needs attention down to what is fine. */
export const VERDICT_ORDER: readonly Verdict[] = [
  'new problem',
  'got worse',
  'still negative',
  'improved: not negative this time',
  'improved: now positive',
  'new positive',
  'still positive',
  'no longer rated positive',
];

export interface ComparedRow {
  question: string;
  verdict: Verdict;
  before: ReportRow | undefined;
  after: ReportRow | undefined;
}

/** Case and runs of spaces are ignored, so the same question typed twice still matches. */
export function questionKey(question: string): string {
  return question.trim().replace(/\s+/g, ' ').toLowerCase();
}

function verdictFor(before: ReportRow | undefined, after: ReportRow | undefined): Verdict {
  if (before && after) {
    if (before.result === 'negative') {
      return after.result === 'negative' ? 'still negative' : 'improved: now positive';
    }
    return after.result === 'negative' ? 'got worse' : 'still positive';
  }
  if (before) {
    return before.result === 'negative'
      ? 'improved: not negative this time'
      : 'no longer rated positive';
  }
  return after?.result === 'negative' ? 'new problem' : 'new positive';
}

/** Queues of rows per question, so a question asked twice is matched first with first, second with second. */
function queuesByQuestion(rows: readonly ReportRow[]): Map<string, ReportRow[]> {
  const queues = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = questionKey(row.question);
    queues.set(key, [...(queues.get(key) ?? []), row]);
  }
  return queues;
}

/**
 * Pairs every rating of the first report with the same question in the second, in order. What the
 * second report has left over is new. Rows keep the order of the first report, new ones follow.
 */
export function compareRows(
  before: readonly ReportRow[],
  after: readonly ReportRow[],
): ComparedRow[] {
  const waiting = queuesByQuestion(after);
  const compared: ComparedRow[] = before.map((row) => {
    const match = waiting.get(questionKey(row.question))?.shift();
    return { question: row.question, verdict: verdictFor(row, match), before: row, after: match };
  });
  const leftover = new Set([...waiting.values()].flat());
  const leftoverInOrder = after.filter((row) => leftover.has(row));
  const added = leftoverInOrder.map((row) => ({
    question: row.question,
    verdict: verdictFor(undefined, row),
    before: undefined,
    after: row,
  }));
  return [...compared, ...added];
}

/** How many rows got each verdict, for the summary. */
export function countVerdicts(rows: readonly ComparedRow[]): Map<Verdict, number> {
  const counts = new Map<Verdict, number>();
  for (const row of rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  return counts;
}
