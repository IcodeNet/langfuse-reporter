import { brand } from '../brand/brand.js';
import type { Conventions } from '../config/config-schema.js';

/** Everything needed to repeat a report: what was asked, of which Langfuse, with which settings. Never holds keys. */
export interface RunInfo {
  cliVersion: string;
  generatedAt: Date;
  profileName: string;
  /** File name only: the folder can hold a user name, and the keys inside are never written. */
  envFileName: string | undefined;
  baseUrl: string;
  /** Window start and end as ISO timestamps; the end is not included. */
  from: string;
  to: string;
  /** The filter as typed, or undefined for none. */
  where: string | undefined;
  conventions: Conventions;
}

const MIDNIGHT = 'T00:00:00.000Z';

/** A whole day is written as 2026-10-13; a window that starts mid-day keeps its time. */
export function asArgument(iso: string): string {
  return iso.endsWith(MIDNIGHT) ? iso.slice(0, 10) : iso;
}

/** Wraps text for a shell so spaces, quotes and symbols in a filter survive copy and paste. */
function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The command that makes the same report again, with the same profile, window and filter. */
export function reproduceCommand(run: RunInfo): string {
  const parts = [
    brand.command,
    '--profile',
    shellQuote(run.profileName),
    'feedback export',
    '--from',
    asArgument(run.from),
    '--to',
    asArgument(run.to),
  ];
  if (run.where) parts.push('--where', shellQuote(run.where));
  return parts.join(' ');
}
