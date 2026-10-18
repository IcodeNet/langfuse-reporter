import { brand } from '../brand/brand.js';
/** A shell command pasted into the session, turned into the session commands that do the same. */
export type ShellTranslation =
  | { kind: 'steps'; steps: string[] }
  | { kind: 'say'; message: string };

/** Splits a line like a shell would: spaces separate words, quotes keep a filter together. */
export function splitShellWords(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (const character of line) {
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started || current !== '') words.push(current);
      current = '';
      started = false;
    } else {
      current += character;
    }
  }
  if (started || current !== '') words.push(current);
  return words;
}

interface Flags {
  values: Map<string, string>;
  switches: Set<string>;
  rest: string[];
}

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--from',
  '--to',
  '--where',
  '--out',
  '--profile',
]);
const SWITCH_FLAGS: ReadonlySet<string> = new Set(['--dry-run', '--yes', '--force-large']);

function parseFlags(words: readonly string[]): Flags | string {
  const flags: Flags = { values: new Map(), switches: new Set(), rest: [] };
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? '';
    if (VALUE_FLAGS.has(word)) {
      const value = words[index + 1];
      if (value === undefined) return `${word} needs a value`;
      flags.values.set(word, value);
      index++;
    } else if (SWITCH_FLAGS.has(word)) {
      flags.switches.add(word);
    } else {
      flags.rest.push(word);
    }
  }
  return flags;
}

const NOT_IN_SESSION: Readonly<Record<string, string>> = {
  '--out':
    'The output folder is a setting here: set outDir <folder> (it is saved for later runs too).',
  '--profile':
    'A one-off profile is a shell feature. In the session use: use <name> (it becomes the active profile).',
};

function windowStep(flags: Flags): string | undefined | { error: string } {
  const from = flags.values.get('--from');
  const to = flags.values.get('--to');
  if (!from && !to) return undefined;
  if (!from || !to)
    return { error: 'Give both --from and --to, as in: window 2026-10-01 2026-10-13' };
  const guard = [...flags.switches].filter((flag) => flag !== '--dry-run').join(' ');
  return `window ${from} ${to}${guard ? ` ${guard}` : ''}`;
}

/** Everything after `feedback`, or after `analyse`, as session steps. */
function translateFeedback(words: readonly string[], flags: Flags): ShellTranslation {
  const sub = words[0];
  const window = windowStep(flags);
  if (typeof window === 'object') return { kind: 'say', message: window.error };
  const where = flags.values.get('--where');
  const steps: string[] = window ? [window] : [];
  if (sub === 'export') {
    if (flags.switches.has('--dry-run')) steps.push(where ? `where ${where}` : 'where');
    else steps.push(where ? `export where ${where}` : 'export');
    return { kind: 'steps', steps };
  }
  if (sub === 'report')
    return { kind: 'steps', steps: [...steps, where ? `report where ${where}` : 'report'] };
  if (sub === 'fields') return { kind: 'steps', steps: ['fields'] };
  if (sub === 'shell') return { kind: 'say', message: 'You are already in the session.' };
  if (sub === 'suggest') {
    return {
      kind: 'say',
      message: 'Suggestions appear as you type a filter here: start typing, e.g. rating =',
    };
  }
  return {
    kind: 'say',
    message: 'In the session the commands are: where, export, report, fields. Type help.',
  };
}

/** Flags that go before the command name in a shell and have no meaning inside a running session. */
const GLOBAL_FLAGS: Readonly<Record<string, string>> = {
  '--profile': NOT_IN_SESSION['--profile'] ?? '',
  '--config':
    'The config file is chosen when the program starts, so it cannot change inside the session.',
};

function liftGlobalFlags(words: readonly string[]): { words: string[]; say?: string } {
  const [first = ''] = words;
  const message = GLOBAL_FLAGS[first];
  if (message) return { words: [...words], say: message };
  return { words: [...words] };
}

/**
 * Turns a line copied from the docs or a "Fix:" hint (`jeves feedback export --dry-run ...`,
 * `feedback report --from ...`) into the session commands that do the same, or says why it cannot.
 * Returns undefined when the line is not a shell command at all.
 */
export function translateShellLine(line: string): ShellTranslation | undefined {
  let words = splitShellWords(line.trim());
  if (words[0] === brand.command) words = words.slice(1);
  const global = liftGlobalFlags(words);
  if (global.say) return { kind: 'say', message: global.say };
  words = global.words;
  const [first, ...after] = words;
  if (first === undefined) return undefined;
  const parsed = parseFlags(after);
  if (typeof parsed === 'string') return { kind: 'say', message: parsed };
  for (const [flag, message] of Object.entries(NOT_IN_SESSION)) {
    if (parsed.values.has(flag)) return { kind: 'say', message };
  }
  switch (first) {
    case 'feedback':
      return translateFeedback(parsed.rest, parsed);
    case 'analyse': {
      const window = windowStep(parsed);
      if (typeof window === 'object') return { kind: 'say', message: window.error };
      const where = parsed.values.get('--where');
      return {
        kind: 'steps',
        steps: [...(window ? [window] : []), where ? `analyse where ${where}` : 'analyse'],
      };
    }
    case 'config':
    case 'docs':
    case 'doctor':
    case 'soul':
    case 'compare':
      return {
        kind: 'steps',
        steps: [after.join(' ') === '' ? first : `${first} ${after.join(' ')}`],
      };
    default:
      return words.length > 0 && line.trim().startsWith(brand.command)
        ? { kind: 'say', message: `"${first}" is not an ${brand.command} command. Type help.` }
        : undefined;
  }
}
