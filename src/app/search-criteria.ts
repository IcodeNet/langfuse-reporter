import { asArgument } from '../output/run-info.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { Block } from '../ui/reporter.js';

export interface SearchCriteria {
  /** Where the ratings are read from. */
  source: string;
  /** What is fetched, in plain words. */
  fetching: string;
  /** What the date window is applied to. */
  window: string;
  /** The filter applied after loading, or "none". */
  filter: string;
  /** Where the question and answer text comes from. */
  text: string;
}

/** A whole day as a date; a boundary with a time keeps it, so a part-day window is not shown as one date. */
function day(iso: string): string {
  return asArgument(iso);
}

function describeWindow(resolved: ResolvedConfig): string {
  const range = `ratings given from ${day(resolved.from)} up to but not including ${day(resolved.to)} (UTC)`;
  return resolved.windowIsDefault
    ? `${range}. Default: the whole previous calendar month. Change it with --from and --to`
    : range;
}

/** Says exactly what a run will ask Langfuse for, so nobody has to guess from a progress line. */
export function describeCriteria(
  resolved: ResolvedConfig,
  where: string | undefined,
  project?: string,
): SearchCriteria {
  const filter = where?.trim();
  return {
    source: `${resolved.profile.baseUrl} (profile ${resolved.profileName})${project ? `, project ${project}` : ''}`,
    fetching: 'thumbs up/down scores and their reason ticks, each recorded on the answer it rated',
    window: describeWindow(resolved),
    filter: filter ? filter : 'none, every rating in the window is kept',
    text: 'the question and answer of each rated turn, and the rest of its conversation',
  };
}

/** Compact single-line form for progress messages. */
export function summariseWindow(resolved: ResolvedConfig): string {
  return `${day(resolved.from)} → ${day(resolved.to)}`;
}

/** Lines printed under the banner, before anything is fetched. */
export function criteriaBlock(criteria: SearchCriteria): Block {
  return {
    title: 'Search criteria',
    rows: [
      ['reading from', criteria.source],
      ['fetching', criteria.fetching],
      ['date window', criteria.window],
      ['filter', criteria.filter],
      ['shown with', criteria.text],
    ],
  };
}
