import { createHash } from 'node:crypto';

const MAX_SLUG_CHARS = 60;

/** Words the filter language uses for operators, spelled out so the name reads like the query. */
const SYMBOL_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/>=/g, ' gte '],
  [/<=/g, ' lte '],
  [/!=/g, ' not '],
  [/>/g, ' gt '],
  [/</g, ' lt '],
  [/=/g, ' '],
];

/** A value typed after a field that can hold a person's id or words; a file name is visible to anyone who lists the folder. */
const PRIVATE_VALUE =
  /\b(user|comment|session|trace|observation)\s*(?:!=|=|\bcontains\b|\bin\b)\s*(?:"[^"]*"|\([^)]*\)|\S+)/gi;

/**
 * Turns a filter into a short, file-safe phrase: "rating = negative AND has_comment = true"
 * becomes "rating-negative-and-has_comment-true". Anything that is not a letter, digit,
 * underscore or hyphen is dropped, so the result can never contain a path separator.
 */
export function slugifyQuery(query: string): string {
  const withoutPrivateValues = query.replace(PRIVATE_VALUE, '$1');
  const spelled = SYMBOL_WORDS.reduce(
    (text, [pattern, word]) => text.replace(pattern, word),
    withoutPrivateValues,
  );
  const slug = spelled
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > MAX_SLUG_CHARS ? slug.slice(0, MAX_SLUG_CHARS).replace(/-$/, '') : slug;
}

/** Sixteen hex characters (64 bits) of the exact query text, so a shortened or similar-looking name stays unique. */
export function queryFingerprint(query: string): string {
  return createHash('sha256').update(query.trim()).digest('hex').slice(0, 16);
}

export interface ExportNameParts {
  /** Window start as an ISO timestamp (the form the config resolves to). */
  from: string;
  /** Window end (exclusive) as an ISO timestamp. */
  to: string;
  /** The filter, or undefined for "everything". */
  query: string | undefined;
  /** A name the user chose; replaces the query-derived part. */
  customName?: string;
}

const SAFE_CUSTOM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;

/** Rejects names that could escape the reports folder or confuse the file system. */
export function validateCustomName(name: string): string {
  if (!SAFE_CUSTOM_NAME.test(name)) {
    throw new Error(
      `"${name}" is not a usable file name. Use letters, digits, "-" and "_" (up to 60 characters), starting with a letter or digit`,
    );
  }
  return name;
}

/**
 * A window boundary as file-safe text: the date alone when it is exactly midnight UTC, otherwise
 * the date and the full time down to the millisecond (2026-09-01T10-30-05-250), so two windows
 * that differ by even one second never share a name.
 */
export function boundaryLabel(iso: string): string {
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 23);
  const isMidnight = time === '' || /^00:00(:00(\.0{1,3})?)?$/.test(time);
  return isMidnight ? day : `${day}T${time.replace(/[:.]/g, '-')}`;
}

/**
 * The shared stem of the two workbooks, for example
 * "2026-09-01_2026-10-01_rating-negative-and-has_comment-true_a1b2c3".
 * The window and a fingerprint of the query are always present, so different queries
 * and different periods never overwrite one another.
 */
export function exportStem({ from, to, query, customName }: ExportNameParts): string {
  const trimmed = query?.trim() ?? '';
  const fingerprint = queryFingerprint(trimmed);
  const label = customName ? validateCustomName(customName) : slugifyQuery(trimmed) || 'all';
  return `${boundaryLabel(from)}_${boundaryLabel(to)}_${label}_${fingerprint}`;
}
