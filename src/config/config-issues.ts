import { brand } from '../brand/brand.js';
import type { ZodError, ZodIssue } from 'zod';
import { didYouMean } from '../dsl/suggest.js';
import { stripControlCharacters } from '../ui/untrusted-text.js';
import { conventionsSchema, profileSchema, configFileSchema } from './config-schema.js';

/** Raised when the config file cannot be used; the message lists every problem with where it is. */
export class ConfigFileError extends Error {}

const MAX_SHOWN_VALUE = 60;

/** A schema path as plain text parts; a symbol key cannot come from a JSON file, so it is shown as its description. */
function pathParts(path: readonly PropertyKey[]): (string | number)[] {
  return path.map((part) => (typeof part === 'symbol' ? String(part.description) : part));
}

/** The keys allowed at a place in the file, so a misspelled key can be answered with the right one. */
function knownKeysAt(path: readonly (string | number)[]): readonly string[] {
  if (path.length === 0) return Object.keys(configFileSchema.shape);
  if (path[0] === 'conventions' && path.length === 1) return Object.keys(conventionsSchema.shape);
  if (path[0] === 'profiles' && path.length === 2) return Object.keys(profileSchema.shape);
  if (path[0] === 'llm' && path.length === 1) return ['provider', 'model', 'baseUrl'];
  return [];
}

function dotted(path: readonly (string | number)[]): string {
  return path.reduce<string>((text, part) => {
    if (typeof part === 'number') return `${text}[${part + 1}]`;
    return text ? `${text}.${part}` : part;
  }, '');
}

function valueAt(raw: unknown, path: readonly (string | number)[]): unknown {
  let current = raw;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

/** The wrong value, quoted, unless it is empty or already named by the message. */
function shown(value: unknown, message: string): string {
  if (value === undefined || value === '') return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const clean = stripControlCharacters(text ?? '');
  if (clean === '' || message.includes(`"${clean}"`)) return '';
  const cut = clean.length > MAX_SHOWN_VALUE ? `${clean.slice(0, MAX_SHOWN_VALUE)}…` : clean;
  return ` (found "${cut}")`;
}

function unknownKeyLines(issue: ZodIssue & { code: 'unrecognized_keys' }): string[] {
  const path = pathParts(issue.path);
  const valid = knownKeysAt(path);
  return issue.keys.map((key) => {
    const where = dotted([...path, key]);
    const hint = didYouMean(key, valid);
    const choices = valid.length > 0 ? ` Allowed here: ${valid.join(', ')}.` : '';
    return `${where}: not a setting.${hint || choices}`;
  });
}

function lineFor(issue: ZodIssue, raw: unknown): string[] {
  if (issue.code === 'unrecognized_keys') return unknownKeyLines(issue);
  const path = pathParts(issue.path);
  const where = dotted(path) || 'the file';
  return [`${where}: ${issue.message}${shown(valueAt(raw, path), issue.message)}`];
}

/** One plain-words line per problem, each with the dotted path to it, e.g. `conventions.reasons[3]: "other_issue" is listed twice`. */
export function describeConfigIssues(error: ZodError, raw: unknown): string[] {
  return error.issues.flatMap((issue) => lineFor(issue, raw));
}

export function configProblemMessage(path: string, lines: readonly string[]): string {
  const list = lines.map((line) => `  - ${line}`).join('\n');
  return `The config file ${path} has problems:\n${list}\nFix the file, or run: ${brand.command} config check`;
}
