import type { Expr, FeedbackRow, Scalar } from './types.js';

function fieldValues(row: FeedbackRow, field: string): Scalar[] {
  switch (field) {
    case 'rating':
      return [row.rating];
    case 'category':
      return row.categories;
    case 'env':
      return [row.environment];
    case 'created':
      return [row.created];
    case 'comment':
      return [row.comment];
    case 'has_comment':
      return [row.comment.length > 0];
    case 'user':
      return [row.userId];
    case 'trace':
      return [row.traceId];
    case 'session':
      return [row.sessionId];
    case 'observation':
      return [row.observationId];
    default:
      return [];
  }
}

function compare(actual: Scalar, op: string, expected: Scalar): boolean {
  switch (op) {
    case '=':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return false;
  }
}

/**
 * Deeper than the parser ever builds (it stops at 64 levels), so reaching it means the tree did
 * not come from the parser. Refusing is safer than a stack overflow.
 */
const MAX_EVALUATION_DEPTH = 256;

/** A multi-valued field (category) matches "!=" only when none of its values equals the target. */
export function matches(expr: Expr | undefined, row: FeedbackRow): boolean {
  return evaluate(expr, row, 0);
}

function evaluate(expr: Expr | undefined, row: FeedbackRow, depth: number): boolean {
  if (!expr) return true;
  if (depth > MAX_EVALUATION_DEPTH) {
    throw new Error(`Filter is nested more than ${MAX_EVALUATION_DEPTH} levels deep`);
  }
  switch (expr.kind) {
    case 'and':
      return evaluate(expr.left, row, depth + 1) && evaluate(expr.right, row, depth + 1);
    case 'or':
      return evaluate(expr.left, row, depth + 1) || evaluate(expr.right, row, depth + 1);
    case 'not':
      return !evaluate(expr.operand, row, depth + 1);
    case 'in': {
      const actual = fieldValues(row, expr.field);
      return actual.some((value) => expr.values.includes(value));
    }
    case 'cmp': {
      const actual = fieldValues(row, expr.field);
      if (expr.op === '!=') return actual.every((value) => compare(value, '!=', expr.value));
      return actual.some((value) => compare(value, expr.op, expr.value));
    }
  }
}
