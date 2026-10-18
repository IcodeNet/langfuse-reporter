import { brand } from '../brand/brand.js';
import { describeWindow, presetWindow, WINDOW_PRESETS } from '../config/window-presets.js';
import { SESSION_HELP } from '../help/command-help.js';
import {
  isSettableKey,
  LLM_PROVIDERS,
  SETTABLE_KEYS,
  SETTING_DESCRIPTIONS,
} from '../config/config-schema.js';
import { complete, type Suggestion } from '../dsl/complete.js';
import { matches } from '../dsl/evaluate.js';
import { formatQueryError, parseQuery } from '../dsl/parse.js';
import { QueryError, type FeedbackRow, type ParseContext } from '../dsl/types.js';
import { TABLE_COLUMNS } from '../ui/table.js';
import { describeReportFile, listReportFiles } from '../compare/list-reports.js';
import { COMMAND_NAMES, CONFIG_SUBCOMMANDS, SESSION_COMMANDS } from './session-commands.js';

export interface SuggestEnv {
  context: ParseContext;
  profiles: readonly string[];
  /** Loaded ratings, if any: enables the live "N rows match" line. */
  rows?: readonly FeedbackRow[];
  /** Where the Excel reports are written; `compare` offers the files in it. */
  reportsDir?: string;
}

export interface LineHints {
  /** Offset in the whole line where the partial word starts. */
  replaceFrom: number;
  suggestions: Suggestion[];
  /** One status line shown under the suggestions: a parse error or a live match count. */
  message?: { kind: 'error' | 'info'; text: string };
}

const PROVIDER_HINTS: Record<(typeof LLM_PROVIDERS)[number], string> = {
  litellm: 'your LiteLLM gateway (set llm.baseUrl); use your own virtual key',
  openai: 'OpenAI API',
  anthropic: 'Anthropic Claude API',
  gemini: 'Google Gemini API',
};

const NONE: LineHints = { replaceFrom: 0, suggestions: [] };

function byPrefix(partial: string, items: ReadonlyArray<readonly [string, string]>): Suggestion[] {
  const prefix = partial.toLowerCase();
  return items
    .filter(([name]) => name.toLowerCase().startsWith(prefix))
    .map(([insert, hint]) => ({ insert, hint }));
}

function lastWordStart(text: string): number {
  return text.length - (text.split(/\s/).at(-1) ?? '').length;
}

function filterHints(line: string, filterStart: number, env: SuggestEnv): LineHints {
  const filter = line.slice(filterStart);
  const { replaceFrom, suggestions } = complete(filter, env.context);
  const message = filterMessage({
    filter,
    env,
    canStillComplete: applicableCount(suggestions) > 0,
  });
  const isError = message?.kind === 'error';
  return {
    replaceFrom: filterStart + replaceFrom,
    suggestions: isError ? [] : suggestions,
    message,
  };
}

function applicableCount(suggestions: ReadonlyArray<{ insert: string }>): number {
  return suggestions.filter((suggestion) => suggestion.insert !== '').length;
}

interface MessageRequest {
  filter: string;
  env: SuggestEnv;
  /** True while the last word is a prefix of something valid, so an error would be premature. */
  canStillComplete: boolean;
}

function filterMessage({ filter, env, canStillComplete }: MessageRequest): LineHints['message'] {
  if (filter.trim() === '') return undefined;
  try {
    const expr = parseQuery(filter, env.context);
    if (!env.rows) return { kind: 'info', text: 'run "load" first to see live match counts' };
    if (env.rows.length === 0)
      return {
        kind: 'info',
        text: 'nothing is loaded for this window; try "window" with other dates',
      };
    const count = env.rows.filter((row) => matches(expr, row)).length;
    return { kind: 'info', text: `${count} of ${env.rows.length} ratings match` };
  } catch (err) {
    if (!(err instanceof QueryError)) throw err;
    const reachedEnd = err.position >= filter.trimEnd().length;
    const midWord = !/\s$/.test(filter);
    const canIgnoreError = midWord && canStillComplete;
    if (reachedEnd || canIgnoreError) return undefined;
    return {
      kind: 'error',
      text: formatQueryError(filter, err).split('\n').slice(1).join(' ').trim(),
    };
  }
}

function exportHints(line: string, afterCommand: number, env: SuggestEnv): LineHints {
  const rest = line.slice(afterCommand);
  const trimmed = rest.trimStart();
  if (trimmed.toLowerCase().startsWith('where ')) {
    const filterStart = afterCommand + (rest.length - trimmed.length) + 'where '.length;
    return filterHints(line, filterStart, env);
  }
  return {
    replaceFrom: lastWordStart(line),
    suggestions: byPrefix(trimmed, [['where', 'only export ratings matching a filter']]),
  };
}

/** What is being typed after a command: the words so far and where the current word starts. */
interface Tail {
  words: string[];
  /** The word being typed; empty right after a space. */
  partial: string;
  replaceFrom: number;
}

function tailOf(line: string, afterCommand: number): Tail {
  const text = line.slice(afterCommand);
  const words = text.trimStart() === '' ? [] : text.trim().split(/\s+/);
  const typingNew = /\s$/.test(line) || text === '';
  return {
    words: typingNew ? words : words.slice(0, -1),
    partial: typingNew ? '' : (words.at(-1) ?? ''),
    replaceFrom: typingNew ? line.length : lastWordStart(line),
  };
}

function hintsFor(tail: Tail, items: ReadonlyArray<readonly [string, string]>): LineHints {
  return { replaceFrom: tail.replaceFrom, suggestions: byPrefix(tail.partial, items) };
}

function noteFor(tail: Tail, text: string): LineHints {
  return { replaceFrom: tail.replaceFrom, suggestions: [{ insert: '', hint: text }] };
}

const SETTING_ITEMS = SETTABLE_KEYS.map((key) => [key, SETTING_DESCRIPTIONS[key]] as const);
const PROVIDER_ITEMS = LLM_PROVIDERS.map((name) => [name, PROVIDER_HINTS[name]] as const);

/** `set <key> <value>`: keys first, then the values that key accepts. */
function settingHints(tail: Tail): LineHints {
  const [key] = tail.words;
  if (key === undefined) return hintsFor(tail, SETTING_ITEMS);
  if (!isSettableKey(key))
    return noteFor(tail, `unknown setting "${key}"; press Esc and start again`);
  if (tail.words.length > 1) return noteFor(tail, 'press Enter to save');
  if (key === 'llm.provider') return hintsFor(tail, PROVIDER_ITEMS);
  return noteFor(tail, `type the new value: ${SETTING_DESCRIPTIONS[key]}`);
}

/** `unset <key>`: only the key, nothing to type after it. */
function unsettingHints(tail: Tail): LineHints {
  if (tail.words.length === 0) return hintsFor(tail, SETTING_ITEMS);
  return noteFor(tail, 'press Enter to reset it to its default');
}

function profileHints(tail: Tail, env: SuggestEnv): LineHints {
  if (tail.words.length > 0) return noteFor(tail, 'press Enter to switch');
  return hintsFor(
    tail,
    env.profiles.map((name) => [name, 'profile'] as const),
  );
}

/** `config show|check|set|unset|use`, each continuing like the matching top-level command. */
function configHints(line: string, afterCommand: number, env: SuggestEnv): LineHints {
  const tail = tailOf(line, afterCommand);
  const [sub] = tail.words;
  if (sub === undefined) return hintsFor(tail, CONFIG_SUBCOMMANDS);
  const rest = tailOf(line, afterCommand + line.slice(afterCommand).search(/\S/) + sub.length);
  switch (sub.toLowerCase()) {
    case 'set':
      return settingHints(rest);
    case 'unset':
      return unsettingHints(rest);
    case 'use':
      return profileHints(rest, env);
    case 'show':
      return noteFor(rest, 'press Enter to show the configuration');
    case 'check':
      return noteFor(rest, 'press Enter to check the config file');
    default:
      return noteFor(
        rest,
        `unknown "config ${sub}"; try: ${CONFIG_SUBCOMMANDS.map(([n]) => n).join(', ')}`,
      );
  }
}

/** Commands that take nothing after them: say so instead of leaving the user guessing. */
const NO_ARGUMENT_HINTS: Record<string, string> = {
  load: 'press Enter to fetch the feedback again; --yes or --force-large for a large window',
  fields: 'press Enter to list the filter fields',
  doctor: 'press Enter to check every link from config to ratings',
  soul: 'press Enter for a picture tour of what this tool does',
  profiles: 'press Enter to list the profiles',
  clear: 'press Enter to clear the screen',
  exit: 'press Enter to leave',
  quit: 'press Enter to leave',
};

/** The ways to ask a command for its help card, offered after any command name. */
const HELP_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['?', 'show how this command works (up to 10 lines)'],
  ['--help', 'show how this command works (up to 10 lines)'],
];

/** True when what follows the command is only a request for help, or the start of one. */
function isHelpRequest(rest: string): boolean {
  const word = rest.trim().toLowerCase();
  const isHelpPrefix = word.startsWith('-') && '--help'.startsWith(word);
  return word === '?' || isHelpPrefix;
}

/** Suggests `?` and `--help` right after a command, and confirms what Enter will do once typed. */
function helpHints(command: string, line: string, afterCommand: number): LineHints | undefined {
  const rest = line.slice(afterCommand);
  if (!SESSION_HELP[command] || !isHelpRequest(rest)) return undefined;
  const tail = tailOf(line, afterCommand);
  const fullyTyped = rest.trim() === '?' || rest.trim().toLowerCase() === '--help';
  if (fullyTyped) return noteFor(tail, `press Enter to read how "${command}" works`);
  return hintsFor(tail, HELP_WORDS);
}

/** `help <command>`: the command names, then a confirmation. */
function helpTopicHints(line: string, afterCommand: number): LineHints {
  const tail = tailOf(line, afterCommand);
  if (tail.words.length > 0) return noteFor(tail, 'press Enter to read it');
  return hintsFor(
    tail,
    SESSION_COMMANDS.filter(([name]) => SESSION_HELP[name]),
  );
}

/** `compare <before> <after>`: offer the report files in the reports folder, newest first. */
function compareHints(line: string, afterCommand: number, env: SuggestEnv): LineHints {
  const tail = tailOf(line, afterCommand);
  if (tail.words.length >= 2) return noteFor(tail, 'press Enter to compare');
  const wanted =
    tail.words.length === 0
      ? 'the older report file (.xlsx), then the newer one'
      : 'now the newer report file (.xlsx), then press Enter';
  const typingAPath = /[\\/]/.test(tail.partial);
  const files =
    env.reportsDir === undefined || typingAPath
      ? []
      : listReportFiles(env.reportsDir).filter((file) => !tail.words.includes(file.name));
  const items = files.map((file) => [file.name, describeReportFile(file)] as const);
  const offered = hintsFor(tail, items);
  if (offered.suggestions.length > 0) return offered;
  return noteFor(
    tail,
    files.length === 0 && tail.partial === '' && !typingAPath
      ? `${wanted}; none found in the reports folder (export one first)`
      : wanted,
  );
}

/** A line whose first word is not a session command is a filter, so users can just start typing one. */
export function isFilterLine(line: string): boolean {
  const firstWord = line.trimStart().split(/\s/)[0]?.toLowerCase() ?? '';
  return firstWord !== '' && !COMMAND_NAMES.has(firstWord);
}

function firstWordHints(line: string, env: SuggestEnv): LineHints {
  const commands = byPrefix(line, SESSION_COMMANDS);
  const fields = complete(line, env.context).suggestions.filter(
    (suggestion) => suggestion.insert !== 'NOT' || line === '',
  );
  return { replaceFrom: 0, suggestions: [...commands, ...fields] };
}

/** A pasted shell command gets one honest hint instead of filter errors. */
function shellHint(line: string): LineHints | undefined {
  const first = line.trimStart().split(/\s/)[0]?.toLowerCase() ?? '';
  if (!line.includes(' ') || (first !== 'feedback' && first !== brand.command)) return undefined;
  const hint = 'a shell command: press Enter and it runs as the session command that does the same';
  return { replaceFrom: line.length, suggestions: [{ insert: '', hint }] };
}

/** The hints for a line whose first word is a command: help requests first, then that command's own. */
function commandHints(line: string, firstSpace: number, env: SuggestEnv): LineHints {
  const command = line.slice(0, firstSpace).toLowerCase();
  const afterCommand = firstSpace + 1;
  const asking = helpHints(command, line, afterCommand);
  if (asking) return asking;
  if (command === 'help' || command === '?') return helpTopicHints(line, afterCommand);
  const noArgument = NO_ARGUMENT_HINTS[command];
  if (noArgument) return noteFor(tailOf(line, afterCommand), noArgument);
  return argumentHints({ command, line, afterCommand, env });
}

/** What can come after the name of each command that takes something. */
interface ArgumentRequest {
  command: string;
  line: string;
  afterCommand: number;
  env: SuggestEnv;
}

function argumentHints({ command, line, afterCommand, env }: ArgumentRequest): LineHints {
  const tail = tailOf(line, afterCommand);
  switch (command) {
    case 'where':
      return filterHints(line, afterCommand, env);
    case 'export':
    case 'analyse':
    case 'report':
      return exportHints(line, afterCommand, env);
    case 'use':
      return profileHints(tail, env);
    case 'set':
      return settingHints(tail);
    case 'unset':
      return unsettingHints(tail);
    case 'config':
      return configHints(line, afterCommand, env);
    case 'compare':
      return compareHints(line, afterCommand, env);
    default:
      return textArgumentHints(command, tail);
  }
}

/** `window`: the preset words with the dates each one means right now, then a note for two dates. */
function windowHints(tail: Tail): LineHints {
  if (tail.words.length === 0) {
    const now = new Date();
    const items = WINDOW_PRESETS.map(([name, hint]) => {
      const window = presetWindow(name, now);
      return [name, window ? `${describeWindow(window)}: ${hint}` : hint] as const;
    });
    return hintsFor(tail, items);
  }
  if (tail.words.length === 1 && presetWindow(tail.words[0] ?? '', new Date())) {
    return noteFor(tail, 'press Enter to load this window');
  }
  return noteFor(tail, 'the end date, not included: window 2026-10-01 2026-10-13 (or today, -3d)');
}

/** Commands whose argument is free text or a short list: dates, columns, a file name, a question. */
function textArgumentHints(command: string, tail: Tail): LineHints {
  switch (command) {
    case 'window':
      return windowHints(tail);
    case 'columns':
      return hintsFor(tail, [
        ...TABLE_COLUMNS.map((column) => [column.key, column.header] as const),
        ['reset', 'back to the default columns'] as const,
      ]);
    case 'save':
      return noteFor(tail, 'optional file name (letters, digits, - and _), then Enter');
    case 'docs':
      return noteFor(
        tail,
        'type your question and press Enter; or press Enter on "docs" alone to chat',
      );
    default:
      return NONE;
  }
}

/** What can legally come next on a session line, plus a live status message for filters. */
export function suggestForLine(line: string, env: SuggestEnv): LineHints {
  const shell = shellHint(line);
  if (shell) return shell;
  if (line.trim() === '?') {
    return {
      replaceFrom: 0,
      suggestions: [
        { insert: '', hint: 'type a space, then a command name; or just press Enter to list them' },
      ],
    };
  }
  const firstSpace = line.search(/\s/);
  if (firstSpace === -1) return firstWordHints(line, env);
  if (isFilterLine(line)) return filterHints(line, 0, env);
  return commandHints(line, firstSpace, env);
}
