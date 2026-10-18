import type { Expr } from './types.js';

/** The deepest tree that is read; the parser itself never builds one deeper than 64. */
const MAX_DEPTH = 256;

/** What Langfuse can narrow for us before anything is downloaded. */
export interface ServerFilters {
  traceId?: string;
  /** Langfuse only accepts an observation together with its trace. */
  observationId?: string;
}

/**
 * Walks an explicit stack, so a tree of any depth cannot overflow the call stack. The parser stops
 * at 64 levels; a deeper tree did not come from it, and then nothing is narrowed.
 */
function collectAnded(root: Expr): Expr[] | undefined {
  const found: Expr[] = [];
  const pending: Array<{ expr: Expr; depth: number }> = [{ expr: root, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.depth > MAX_DEPTH) return undefined;
    if (next.expr.kind === 'and') {
      pending.push({ expr: next.expr.right, depth: next.depth + 1 });
      pending.push({ expr: next.expr.left, depth: next.depth + 1 });
    } else {
      found.push(next.expr);
    }
  }
  return found;
}

function singleValue(expr: readonly Expr[], field: 'trace' | 'observation'): string | undefined {
  const values = new Set<string>();
  for (const part of expr) {
    if (part.kind === 'cmp' && part.field === field && part.op === '=')
      values.add(String(part.value));
  }
  return values.size === 1 ? [...values][0] : undefined;
}

/**
 * The trace and observation a filter pins down, taken only from conditions joined by AND at the
 * top. A condition under OR or NOT is never used, and the full filter still runs on what comes
 * back, so this can only shrink the download, never change which ratings match. The session is
 * left out: Langfuse does not return turn ratings when asked by session.
 */
export function serverFiltersFor(expr: Expr | undefined): ServerFilters {
  if (!expr) return {};
  const parts = collectAnded(expr);
  if (!parts) return {};
  const traceId = singleValue(parts, 'trace');
  if (traceId === undefined) return {};
  const observationId = singleValue(parts, 'observation');
  return observationId === undefined ? { traceId } : { traceId, observationId };
}
