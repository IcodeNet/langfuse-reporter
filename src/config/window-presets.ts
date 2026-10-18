const DAY_MS = 86_400_000;

/** A window as the two ISO instants the rest of the CLI uses; `to` is not included. */
export interface DateWindow {
  from: string;
  to: string;
}

/** The words a person can type for a whole window, with a one-line meaning for the suggestions. */
export const WINDOW_PRESETS: ReadonlyArray<readonly [name: string, hint: string]> = [
  ['today', 'today only'],
  ['yesterday', 'yesterday only'],
  ['7d', 'the last 7 days, today included'],
  ['30d', 'the last 30 days, today included'],
  ['this-week', 'Monday to now'],
  ['last-week', 'last Monday to last Sunday'],
  ['this-month', 'the 1st of this month to now'],
  ['last-month', 'the whole previous calendar month'],
  ['reset', 'back to the default (last month)'],
];

const DAYS_AGO = /^-(\d{1,4})d$/;
const LAST_N_DAYS = /^(\d{1,4})d$/;

function startOfDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Monday 00:00 UTC of the week that contains `now`. */
function startOfWeek(now: Date): number {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  return startOfDay(now) - sinceMonday * DAY_MS;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Calendar-month start, `monthsBack` months before the one containing `now`. */
function startOfMonth(now: Date, monthsBack: number): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1);
}

/**
 * A single word that stands for a whole window, or undefined when the word is not a preset.
 * The end is always the first instant AFTER the period, because Langfuse windows do not include it.
 */
export function presetWindow(word: string, now: Date): DateWindow | undefined {
  const name = word.trim().toLowerCase();
  const today = startOfDay(now);
  const tomorrow = today + DAY_MS;
  const lastN = LAST_N_DAYS.exec(name);
  if (lastN) return { from: iso(tomorrow - Number(lastN[1]) * DAY_MS), to: iso(tomorrow) };
  switch (name) {
    case 'today':
      return { from: iso(today), to: iso(tomorrow) };
    case 'yesterday':
      return { from: iso(today - DAY_MS), to: iso(today) };
    case 'this-week':
      return { from: iso(startOfWeek(now)), to: iso(tomorrow) };
    case 'last-week':
      return { from: iso(startOfWeek(now) - 7 * DAY_MS), to: iso(startOfWeek(now)) };
    case 'this-month':
      return { from: iso(startOfMonth(now, 0)), to: iso(tomorrow) };
    case 'last-month':
      return { from: iso(startOfMonth(now, 1)), to: iso(startOfMonth(now, 0)) };
    default:
      return undefined;
  }
}

/**
 * One boundary typed as a date: a calendar day, a full timestamp, or a relative word. Returns the
 * ISO instant, or undefined when the text is none of those. `asEnd` makes `today` and `-3d` mean the
 * end of that day, so `window -3d today` covers today as people expect.
 */
export function relativeBoundary(text: string, now: Date, asEnd: boolean): string | undefined {
  const word = text.trim().toLowerCase();
  const today = startOfDay(now);
  const endShift = asEnd ? DAY_MS : 0;
  if (word === 'today') return iso(today + endShift);
  if (word === 'yesterday') return iso(today - DAY_MS + endShift);
  const ago = DAYS_AGO.exec(word);
  if (ago) return iso(today - Number(ago[1]) * DAY_MS + endShift);
  return undefined;
}

/** What `window` shows after it resolves a preset, so the user sees the real dates it picked. */
export function describeWindow(window: DateWindow): string {
  const last = new Date(Date.parse(window.to) - DAY_MS);
  const first = window.from.slice(0, 10);
  const lastDay = last.toISOString().slice(0, 10);
  return first === lastDay ? first : `${first} to ${lastDay} inclusive`;
}
