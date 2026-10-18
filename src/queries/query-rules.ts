export const MEASURES = ['count', 'negative-count', 'negative-rate'] as const;
export type Measure = (typeof MEASURES)[number];

export const OPERATORS = ['<=', '>=', '<', '>', '='] as const;
export type Operator = (typeof OPERATORS)[number];

export interface Rule {
  measure: Measure;
  op: Operator;
  limit: number;
  /** When set, the rule is skipped (not failed) if the window holds fewer ratings than this. */
  minRatings?: number;
}

/** The only numbers a rule can look at. The rate divides the matched negatives by every rating in the window, so a filter never turns it into 1. */
export interface Counts {
  /** Ratings that match the filter. */
  total: number;
  /** Matching ratings that are negative. */
  negative: number;
  /** Every rating in the window, matching or not. */
  windowTotal: number;
}

export interface RuleResult {
  rule: string;
  /** Null when the measure cannot be worked out, for example a rate over zero ratings. */
  actual: number | null;
  /** `skipped` means the rule's own `min-ratings` guard was not met, so there was too little data to judge. */
  status: 'pass' | 'fail' | 'unchecked' | 'skipped';
}

const RULE_PATTERN =
  /^(count|negative-count|negative-rate)\s*(<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)(?:\s+min-ratings\s+(\d+))?$/;

/** The rule, or the reason it is not one. */
export function parseRule(text: string): { rule: Rule } | { problem: string } {
  const found = RULE_PATTERN.exec(text.trim());
  if (!found) {
    return {
      problem: `"${text}" is not a rule. Write a measure, a comparison and a number, for example "negative-rate <= 0.2". Measures: ${MEASURES.join(', ')}. Comparisons: ${OPERATORS.join(' ')}`,
    };
  }
  const [, measure, op, limit, minRatings] = found as unknown as [
    string,
    Measure,
    Operator,
    string,
    string | undefined,
  ];
  if (measure === 'negative-rate' && Number(limit) > 1) {
    return {
      problem: `"${text}": negative-rate is a share between 0 and 1, so ${limit} is too big`,
    };
  }
  return {
    rule: {
      measure,
      op,
      limit: Number(limit),
      ...(minRatings === undefined ? {} : { minRatings: Number(minRatings) }),
    },
  };
}

function measureOf(measure: Measure, counts: Counts): number | null {
  if (measure === 'count') return counts.total;
  if (measure === 'negative-count') return counts.negative;
  return counts.windowTotal === 0 ? null : counts.negative / counts.windowTotal;
}

function compare(actual: number, op: Operator, limit: number): boolean {
  switch (op) {
    case '<=':
      return actual <= limit;
    case '>=':
      return actual >= limit;
    case '<':
      return actual < limit;
    case '>':
      return actual > limit;
    case '=':
      return actual === limit;
  }
}

/** Checks one rule. A rate over an empty window is "unchecked", never a pass, so an empty window cannot hide a problem. */
export function checkRule(text: string, counts: Counts): RuleResult {
  const parsed = parseRule(text);
  if (!('rule' in parsed)) return { rule: text, actual: null, status: 'unchecked' };
  const { measure, op, limit, minRatings } = parsed.rule;
  const actual = measureOf(measure, counts);
  if (minRatings !== undefined && counts.windowTotal < minRatings) {
    return { rule: text, actual, status: 'skipped' };
  }
  if (actual === null) return { rule: text, actual, status: 'unchecked' };
  return { rule: text, actual, status: compare(actual, op, limit) ? 'pass' : 'fail' };
}
