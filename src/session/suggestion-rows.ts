import { padVisible, type Palette } from '../ui/ansi.js';
import { displayWidth } from '../ui/display-width.js';
import { toOneLine as safe } from '../ui/untrusted-text.js';
import { applicable, visibleWindow } from './editor-logic.js';
import type { LineHints } from './suggest-line.js';

const MAX_SHOWN_SUGGESTIONS = 8;

export interface SuggestionRowsRequest {
  hints: LineHints;
  selected: number | undefined;
  paint: Palette;
}

/**
 * The rows drawn under the prompt. Suggestion names come from live Langfuse values (users,
 * environments), so every piece of text is stripped of terminal control sequences first.
 */
export function suggestionRows({ hints, selected, paint }: SuggestionRowsRequest): string[] {
  const choices = applicable(hints.suggestions);
  const { start, end } = visibleWindow(selected, hints.suggestions.length, MAX_SHOWN_SUGGESTIONS);
  const shown = hints.suggestions.slice(start, end);
  const width = Math.max(0, ...shown.map((suggestion) => displayWidth(safe(suggestion.insert))));
  const rows: string[] = [];
  if (start > 0) rows.push(paint.dim(`  ↑ ${start} more`));
  for (const suggestion of shown) {
    const isSelected = selected !== undefined && choices[selected] === suggestion;
    const name = suggestion.insert === '' ? '…' : safe(suggestion.insert);
    const line = `${padVisible(name, width)}  ${safe(suggestion.hint)}`;
    rows.push(isSelected ? paint.gold(`› ${line}`) : paint.dim(`  ${line}`));
  }
  const hiddenBelow = hints.suggestions.length - end;
  if (hiddenBelow > 0) rows.push(paint.dim(`  ↓ ${hiddenBelow} more`));
  if (hints.message) {
    const colorize = hints.message.kind === 'error' ? paint.red : paint.green;
    rows.push(colorize(`  ${safe(hints.message.text)}`));
  }
  return rows;
}
