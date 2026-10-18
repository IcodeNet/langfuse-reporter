import type { Suggestion } from '../dsl/complete.js';

export type Direction = 1 | -1;

/** Suggestions with an empty insert are hints only; they cannot be selected or applied. */
export function applicable(suggestions: readonly Suggestion[]): Suggestion[] {
  return suggestions.filter((suggestion) => suggestion.insert !== '');
}

/** Words get a trailing space so the next token's suggestions appear straight away. */
function needsTrailingSpace(insert: string): boolean {
  const opensQuotedValue = insert === '"';
  return /^[A-Za-z0-9_\-"]/.test(insert) && !insert.endsWith('(') && !opensQuotedValue;
}

/** Replaces from `replaceFrom` to the end of `base` with the suggestion. */
export function applySuggestion(base: string, replaceFrom: number, insert: string): string {
  return `${base.slice(0, replaceFrom)}${insert}${needsTrailingSpace(insert) ? ' ' : ''}`;
}

export interface ArrowState {
  browsingHistory: boolean;
  bufferIsEmpty: boolean;
  hasSelection: boolean;
  hasChoices: boolean;
  direction: Direction;
}

/**
 * What an Up or Down arrow does: walk the saved commands, or move through the suggestions. History
 * wins while the user is already walking it, when nothing is suggested, and on Up from an empty
 * prompt (the first press recalls the last command, as in a shell).
 */
export function arrowTarget(state: ArrowState): 'history' | 'suggestions' {
  if (!state.hasChoices || state.browsingHistory) return 'history';
  const recallsLast = state.bufferIsEmpty && !state.hasSelection && state.direction === -1;
  return recallsLast ? 'history' : 'suggestions';
}

/** Arrow keys: with nothing selected Down picks the first and Up the last; both wrap at the ends. */
export function moveSelection(
  current: number | undefined,
  count: number,
  direction: Direction,
): number | undefined {
  if (count === 0) return undefined;
  if (current === undefined) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

export interface RowWindow {
  start: number;
  end: number;
}

/** Keeps the selected row inside a fixed-height window over a long list. */
export function visibleWindow(
  selected: number | undefined,
  total: number,
  size: number,
): RowWindow {
  if (total <= size) return { start: 0, end: total };
  const anchor = selected ?? 0;
  const start = Math.min(Math.max(0, anchor - size + 1), total - size);
  return { start, end: start + size };
}
