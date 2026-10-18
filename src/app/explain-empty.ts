import { summariseWindow } from './search-criteria.js';
import type { ResolvedConfig } from '../config/resolve-config.js';

const DAY_MS = 86_400_000;

/** What loading left out, so an empty result can say why. */
export interface LoadNotes {
  /** Ratings that sit on the whole trace, not on one chat turn; the CLI cannot place them. */
  traceLevelRatings: number;
  /** Ratings whose answer Langfuse did not return when asked. */
  missingTurns: number;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Start and end of the last week, ending tomorrow so today is covered. */
function lastWeek(now: Date): { from: string; to: string } {
  return {
    from: day(new Date(now.getTime() - 7 * DAY_MS)),
    to: day(new Date(now.getTime() + DAY_MS)),
  };
}

/** A command to paste inside the session. */
export function lastWeekCommand(now: Date): string {
  const { from, to } = lastWeek(now);
  return `window ${from} ${to}`;
}

/** The same window as flags, for a one-shot run outside the session. */
export function lastWeekFlags(now: Date): string {
  const { from, to } = lastWeek(now);
  return `--from ${from} --to ${to}`;
}

export interface EmptyRequest {
  rowCount: number;
  notes: LoadNotes;
  resolved: ResolvedConfig;
  now: Date;
  /** True inside the session, where the next step is a session command rather than flags. */
  interactive: boolean;
}

/** Plain-English reasons and next steps for a load that produced no rows. Empty when rows exist. */
export function explainEmpty(request: EmptyRequest): string[] {
  const { rowCount, notes, resolved, now, interactive } = request;
  if (rowCount > 0) return [];
  const tryWindow = interactive ? lastWeekCommand(now) : lastWeekFlags(now);
  const kind = notes.traceLevelRatings > 0 ? 'ratings on a chat turn' : 'ratings';
  const lines = [
    `No ${kind} were found for ${summariseWindow(resolved)} on profile "${resolved.profileName}".`,
  ];
  if (notes.traceLevelRatings > 0) {
    lines.push(
      `${notes.traceLevelRatings} rating(s) were found, but they sit on the whole trace, not on one chat turn. The CLI only reads turn-level ratings, so it cannot place them. The app that wrote them needs to record the rating on the chat-turn.`,
    );
  }
  if (notes.missingTurns > 0) {
    lines.push(
      `${notes.missingTurns} rating(s) point at an answer Langfuse no longer returns. Try a narrower window; if it persists, open the trace in Langfuse.`,
    );
  }
  if (notes.traceLevelRatings === 0 && notes.missingTurns === 0) {
    lines.push(
      `If you expected feedback, the window may be wrong: the end date is not included. Try: ${tryWindow}`,
      'Or the profile may be the wrong one: check with "config show".',
    );
  }
  return lines;
}
