import { brand, promptWord } from '../brand/brand.js';
import { describeWindow, presetWindow, type DateWindow } from '../config/window-presets.js';
import { translateShellLine } from './shell-line.js';
import { runCompare } from '../compare/run-compare.js';
import { runDoctor } from '../app/run-doctor.js';
import { runSoul, showSoulInvite } from '../app/run-soul.js';
import { isProduction } from '../app/production.js';
import { newEnvFileWarning } from '../config/path-warnings.js';
import { runDocsChat } from './docs-chat.js';
import { showReport } from '../pager/show-report.js';
import { historyPathFor, loadHistory, saveHistoryLine } from './history-store.js';
import { SESSION_HELP } from '../help/command-help.js';
import { lastWeekCommand } from '../app/explain-empty.js';
import { writtenFileRows } from '../app/written-files.js';
import {
  checkConfigFile,
  loadConfigFile,
  listProfilesSync,
  saveConfigFile,
  setConfigValue,
  unsetConfigValue,
  useProfile,
} from '../config/config-store.js';
import { applyToProfile } from '../config/apply-to-profile.js';
import { settingRows } from '../config/config-report.js';
import type { ConfigFile } from '../config/config-schema.js';
import type { Block } from '../ui/reporter.js';
import { configBlock } from '../config/format-config.js';
import { describeFields } from '../dsl/describe-fields.js';
import { buildFields, fieldsOf } from '../dsl/fields.js';
import { DEFAULT_CONVENTIONS } from '../config/config-schema.js';
import { loadDataset, type Dataset } from '../app/load-dataset.js';
import { runAnalyse } from '../app/run-analyse.js';
import { runDocs, type DocsExchange } from '../app/run-docs.js';
import { compileWhere, runExport } from '../app/run-export.js';
import { printBanner, refuseInDemo, resolveRun, type AppContext } from '../app/app-context.js';
import { matches } from '../dsl/evaluate.js';
import { validateCustomName } from '../output/export-name.js';
import { createPalette } from '../ui/ansi.js';
import { DEFAULT_TABLE_COLUMNS, findColumn, renderTable, TABLE_COLUMNS } from '../ui/table.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { readLine } from './line-editor.js';
import { COMMAND_NAMES, CREDITS, SESSION_COMMANDS } from './session-commands.js';
import { didYouMean } from '../dsl/suggest.js';
import { isFilterLine, suggestForLine } from './suggest-line.js';

interface SessionState {
  resolved: ResolvedConfig;
  dataset: Dataset | undefined;
  /** Table columns the user chose, in order. */
  columns: string[];
  /** The filter last shown with `where`; `save` and `export` with no filter reuse it. */
  lastQuery: string | undefined;
  /** Questions and answers from `docs` in this session, so a follow-up question has its context. */
  docsHistory: DocsExchange[];
  /** Date window chosen with `window` or the --from/--to flags; unset means the default month. */
  window: { from?: string; to?: string };
}

/** Flags a user can add to `load` or `window` to get past the size guard. */
export interface LoadFlags {
  yes: boolean;
  forceLarge: boolean;
}

/** Splits `--yes` and `--force-large` off the words of a command, returning the flags and what is left. */
export function takeLoadFlags(words: readonly string[]): { flags: LoadFlags; rest: string[] } {
  const flags: LoadFlags = {
    yes: words.includes('--yes'),
    forceLarge: words.includes('--force-large'),
  };
  return { flags, rest: words.filter((word) => word !== '--yes' && word !== '--force-large') };
}

async function reload(
  app: AppContext,
  state: SessionState,
  flags: Partial<LoadFlags> = {},
): Promise<void> {
  state.resolved = await resolveRun(app, state.window);
  try {
    state.dataset = await loadDataset(state.resolved, app.reporter, {
      ...flags,
      interactive: true,
    });
  } catch (err) {
    state.dataset = undefined;
    app.reporter.cancel();
    app.reporter.warn(err instanceof Error ? err.message : String(err));
  }
}

function fieldsBlock(state: SessionState): Block {
  return {
    title: 'Filter fields',
    emoji: '🧩',
    rows: describeFields(fieldsOf({ fields: buildFields(state.resolved.conventions.reasons) })),
  };
}

interface CommandRequest {
  app: AppContext;
  state: SessionState;
  argument: string;
}

/** Returns false to end the session. */
type CommandHandler = (request: CommandRequest) => Promise<boolean> | boolean;

function requireDataset(request: CommandRequest): Dataset | undefined {
  if (request.state.dataset) return request.state.dataset;
  request.app.reporter.warn('Nothing loaded yet. Run "load" first.');
  return undefined;
}

async function useProfileCommand({ app, state, argument }: CommandRequest): Promise<boolean> {
  const task = app.reporter.task(`Switching to profile "${argument}"`, 'switch');
  const file = await loadConfigFile(app.configPath);
  await saveConfigFile(app.configPath, useProfile(file, argument));
  task.succeed(`Profile "${argument}" is now active`);
  app.profileOverride = undefined;
  await reload(app, state);
  return true;
}

const DATA_SETTINGS: ReadonlySet<string> = new Set([
  'profile.baseUrl',
  'profile.envFile',
  'conventions.turnName',
  'conventions.ratingScore',
  'conventions.reasonScorePrefix',
  'conventions.reasons',
  'conventions.yesValues',
]);

/** Whether changing this setting makes the loaded ratings stale, so they must be fetched again. */
export function settingNeedsReload(key: string): boolean {
  return DATA_SETTINGS.has(key);
}

interface SettingChange {
  request: CommandRequest;
  key: string;
  describe: string;
  change: (file: ConfigFile) => ConfigFile;
}

async function applySettingChange({
  request,
  key,
  describe,
  change,
}: SettingChange): Promise<void> {
  const { app, state } = request;
  const task = app.reporter.task(`Saving ${key}`, 'save');
  let before: ConfigFile;
  try {
    before = await loadConfigFile(app.configPath);
    await saveConfigFile(app.configPath, applyToProfile(before, app.profileOverride, change));
  } catch (err) {
    task.fail(`Could not save ${key}`);
    throw err;
  }
  task.succeed(describe);
  const saved = await loadConfigFile(app.configPath);
  const problem = newEnvFileWarning(before, saved, app.profileOverride ?? saved.activeProfile);
  if (problem) app.reporter.warn(problem);
  if (settingNeedsReload(key)) {
    app.reporter.info('This changes where the feedback comes from, so it is being loaded again');
    await reload(app, state);
    return;
  }
  state.resolved = await resolveRun(app, state.window);
}

async function setCommand(request: CommandRequest): Promise<boolean> {
  const [key = '', ...valueParts] = request.argument.split(/\s+/);
  const value = valueParts.join(' ');
  await applySettingChange({
    request,
    key,
    describe: `Saved ${key} = ${value}`,
    change: (file) => setConfigValue(file, key, value),
  });
  return true;
}

async function unsetCommand(request: CommandRequest): Promise<boolean> {
  const key = request.argument.trim();
  await applySettingChange({
    request,
    key,
    describe: `Reset ${key} to its default`,
    change: (file) => unsetConfigValue(file, key),
  });
  return true;
}

/** `config` alone shows the settings; `config set|unset|use ...` changes them like the top-level commands. */
async function configCommand(request: CommandRequest): Promise<boolean> {
  const [sub = 'show', ...rest] = request.argument.split(/\s+/).filter(Boolean);
  const argument = rest.join(' ');
  switch (sub.toLowerCase()) {
    case 'show':
      request.app.reporter.block(configBlock(request.state.resolved, request.app.configPath));
      request.app.reporter.block({
        title: 'Settings (change with config set <key> <value>, or edit the file)',
        emoji: '🛠️ ',
        rows: settingRows(
          await loadConfigFile(request.app.configPath),
          request.state.resolved.profileName,
        ),
      });
      return true;
    case 'set':
      return setCommand({ ...request, argument });
    case 'unset':
      return unsetCommand({ ...request, argument });
    case 'use':
      return useProfileCommand({ ...request, argument });
    case 'check': {
      const result = await checkConfigFile(request.app.configPath);
      if (result.problems.length === 0) request.app.reporter.done('The config file is valid');
      for (const problem of result.problems) request.app.reporter.warn(problem);
      return true;
    }
    default:
      request.app.reporter.warn(
        `Unknown "config ${sub}". Use: config show | check | set <key> <value> | unset <key> | use <profile>`,
      );
      return true;
  }
}

/** Rows shown in the terminal before "… N more"; the Excel export always has every row. */
const TABLE_ROW_LIMIT = 15;

function whereCommand(request: CommandRequest): boolean {
  const dataset = requireDataset(request);
  if (!dataset) return true;
  const { app, state, argument } = request;
  const expr = compileWhere(argument, dataset);
  const hits = dataset.rows.filter((row) => matches(expr, row));
  if (dataset.rows.length === 0) {
    app.reporter.warn(
      `Nothing is loaded for this window, so there is nothing to filter. Try: ${lastWeekCommand(new Date())}`,
    );
    return true;
  }
  state.lastQuery = argument.trim() === '' ? undefined : argument.trim();
  app.reporter.done(`${hits.length} of ${dataset.rows.length} ratings match`);
  if (hits.length === 0) return true;
  const palette = createPalette(app.color);
  const table = renderTable(hits, {
    columns: state.columns,
    width: Math.max(40, app.columns - 2),
    limit: TABLE_ROW_LIMIT,
    decorate: (kind, text) => {
      if (kind === 'header') return palette.cyan(text);
      return kind === 'positive' ? palette.green(text) : palette.red(text);
    },
  });
  app.reporter.note(table.text);
  if (table.hiddenRows > 0) {
    app.reporter.info(`… ${table.hiddenRows} more. "save" writes all ${hits.length} to Excel.`);
  }
  if (table.dropped.length > 0) {
    app.reporter.info(
      `Left out for width: ${table.dropped.join(', ')}. Widen the window or pick fewer columns.`,
    );
  }
  return true;
}

/** `columns` lists the choices; `columns a b c` picks them; `columns reset` goes back to the default. */
function columnsCommand({ app, state, argument }: CommandRequest): boolean {
  const asked = argument.split(/[\s,]+/).filter(Boolean);
  if (asked.length === 0) {
    app.reporter.block({
      title: `Table columns (showing: ${state.columns.join(', ')})`,
      emoji: '🧱',
      rows: TABLE_COLUMNS.map((column) => [column.key, column.header]),
    });
    return true;
  }
  if (asked.length === 1 && asked[0]?.toLowerCase() === 'reset') {
    state.columns = [...DEFAULT_TABLE_COLUMNS];
    app.reporter.done(`Columns reset: ${state.columns.join(', ')}`);
    return true;
  }
  const unknown = asked.filter((key) => !findColumn(key));
  if (unknown.length > 0) {
    app.reporter.warn(
      `Unknown column ${unknown.join(', ')}. Choose from: ${TABLE_COLUMNS.map((c) => c.key).join(', ')}`,
    );
    return true;
  }
  state.columns = asked.map((key) => key.toLowerCase());
  app.reporter.done(`Columns: ${state.columns.join(', ')}. Run where <filter> to see them.`);
  return true;
}

/**
 * What follows `export`: nothing (export everything), or `where <filter>`. Anything else returns
 * null so a typo cannot silently export every rating instead of the few that were meant.
 */
export function parseExportArgument(argument: string): string | undefined | null {
  const trimmed = argument.trim();
  if (trimmed === '') return undefined;
  const found = /^where\s+(\S.*)$/is.exec(trimmed);
  return found?.[1]?.trim() ?? null;
}

interface WriteRequest {
  request: CommandRequest;
  where: string | undefined;
  name?: string;
}

async function writeFiles({ request, where, name }: WriteRequest): Promise<void> {
  const dataset = requireDataset(request);
  if (!dataset) return;
  const { app, state } = request;
  const paths = await runExport({
    dataset,
    resolved: state.resolved,
    reporter: app.reporter,
    where,
    name,
  });
  if (!paths) return;
  app.reporter.block({
    title: 'Files written',
    emoji: '📁',
    rows: writtenFileRows(paths),
  });
}

async function exportCommand(request: CommandRequest): Promise<boolean> {
  const where = parseExportArgument(request.argument);
  if (where === null) {
    request.app.reporter.warn(
      `export takes nothing, or "where <filter>". For example: export where rating = negative. Got: "${request.argument}"`,
    );
    return true;
  }
  await writeFiles({ request, where });
  return true;
}

/** `report` pages through the ratings; it uses the filter last shown with `where`, or `report where <filter>`. */
async function reportCommand(request: CommandRequest): Promise<boolean> {
  const dataset = requireDataset(request);
  if (!dataset) return true;
  const { app, state } = request;
  const asked = parseExportArgument(request.argument);
  if (asked === null) {
    app.reporter.warn(`report takes nothing, or "where <filter>". Got: "${request.argument}"`);
    return true;
  }
  if (dataset.rows.length === 0) {
    app.reporter.warn(
      `Nothing is loaded for this window, so there is nothing to read. Try: ${lastWeekCommand(new Date())}`,
    );
    return true;
  }
  const shown = await showReport({
    dataset,
    resolved: state.resolved,
    reporter: app.reporter,
    where: asked ?? state.lastQuery,
    color: app.color,
    columns: app.columns,
  });
  app.reporter.info(`Left the report (${shown} ratings shown)`);
  return true;
}

/** `analyse` uses the query last shown with `where`; `analyse where <filter>` uses a new one. */
async function analyseCommand(request: CommandRequest): Promise<boolean> {
  const dataset = requireDataset(request);
  if (!dataset) return true;
  const { app, state } = request;
  const { flags, rest } = takeLoadFlags(request.argument.split(/\s+/).filter(Boolean));
  const where = parseExportArgument(rest.join(' '));
  if (where === null) {
    app.reporter.warn(
      'analyse takes nothing, or "where <filter>". For example: analyse where rating = negative',
    );
    return true;
  }
  await runAnalyse({
    dataset,
    resolved: state.resolved,
    reporter: app.reporter,
    where: where ?? state.lastQuery,
    yes: flags.yes,
  });
  return true;
}

/** `save` writes the query last shown with `where`; `save <name>` also names the files. */
async function saveCommand(request: CommandRequest): Promise<boolean> {
  const { app, state, argument } = request;
  const name = argument.trim() === '' ? undefined : argument.trim();
  if (name) {
    try {
      validateCustomName(name);
    } catch (err) {
      app.reporter.warn(err instanceof Error ? err.message : String(err));
      return true;
    }
  }
  const what = state.lastQuery ? `"${state.lastQuery}"` : 'every rating';
  app.reporter.info(`Saving ${what}`);
  await writeFiles({ request, where: state.lastQuery, name });
  return true;
}

function listProfiles({ app }: CommandRequest): boolean {
  const { activeProfile, profiles } = listProfilesSync(app.configPath);
  app.reporter.block({
    title: 'Profiles (* = active)',
    emoji: '👤',
    rows: profiles.map((profile) => [
      `${profile.name === activeProfile ? '*' : ' '} ${profile.name}`,
      profile.baseUrl,
    ]),
  });
  return true;
}

/** `window 2026-10-01 2026-10-13` sets the dates and loads them; `window reset` returns to last month. */
/** What the session keeps as the chosen window: nothing for reset, the preset's dates, or the two words typed. */
function windowChoice(
  isReset: boolean,
  preset: DateWindow | undefined,
  words: readonly string[],
): { from?: string; to?: string } {
  if (isReset) return {};
  if (preset) return preset;
  return { from: words[0], to: words[1] };
}

async function windowCommand(request: CommandRequest): Promise<boolean> {
  const { app, state, argument } = request;
  const { flags, rest: words } = takeLoadFlags(argument.split(/\s+/).filter(Boolean));
  const isReset = words.length === 1 && words[0]?.toLowerCase() === 'reset';
  const preset = words.length === 1 ? presetWindow(words[0] ?? '', new Date()) : undefined;
  if (!isReset && !preset && words.length !== 2) {
    app.reporter.warn(
      'Usage: window <from> <to> (2026-10-01 2026-10-13, the end is not included), or one word: today, yesterday, 7d, 30d, this-week, last-week, this-month, last-month, reset',
    );
    return true;
  }
  if (preset) app.reporter.info(`Window "${words[0]}" is ${describeWindow(preset)} (UTC)`);
  const chosen = windowChoice(isReset, preset, words);
  /** Checked before it is kept, so a bad date cannot leave later loads failing the same way. */
  await resolveRun(app, chosen);
  state.window = chosen;
  await reload(app, state, flags);
  return true;
}

/** Clears the screen and the scrollback; `clear` also forgets the `docs` conversation. */
export const CLEAR_SCREEN = '\u001b[2J\u001b[3J\u001b[H';

async function clearCommand({ app, state }: CommandRequest): Promise<boolean> {
  if (app.interactive) process.stderr.write(CLEAR_SCREEN);
  const forgot = state.docsHistory.length;
  state.docsHistory.length = 0;
  app.reporter.done(
    forgot > 0
      ? `Screen cleared. The docs conversation (${forgot} question${forgot === 1 ? '' : 's'}) was forgotten.`
      : 'Screen cleared.',
  );
  return true;
}

function showCredits({ app }: CommandRequest): boolean {
  app.reporter.block({ title: 'Credits', emoji: '🙏', rows: CREDITS });
  return true;
}

const COMMANDS: Record<string, CommandHandler> = {
  exit: () => false,
  quit: () => false,
  help: ({ app, argument }) => {
    const topic = argument.trim().toLowerCase();
    if (topic !== '') {
      showHelpCard(app, topic);
      return true;
    }
    app.reporter.block({ title: 'Commands', emoji: '📖', rows: SESSION_COMMANDS });
    return true;
  },
  credits: showCredits,
  soul: async ({ app }) => {
    await runSoul(app);
    return true;
  },
  '?': ({ app, argument }) => {
    const topic = argument.trim().toLowerCase();
    if (topic === '')
      app.reporter.block({ title: 'Commands', emoji: '📖', rows: SESSION_COMMANDS });
    else showHelpCard(app, topic);
    return true;
  },
  '/credits': showCredits,
  fields: ({ app, state }) => {
    app.reporter.block(fieldsBlock(state));
    return true;
  },
  config: configCommand,
  profiles: listProfiles,
  clear: clearCommand,
  docs: async ({ app, state, argument }) => {
    if (argument.trim() === '') {
      return runDocsChat({ app, resolved: state.resolved, history: state.docsHistory });
    }
    await runDocs({
      resolved: state.resolved,
      reporter: app.reporter,
      question: argument,
      history: state.docsHistory,
    });
    return true;
  },
  load: async ({ app, state, argument }) => {
    await reload(app, state, takeLoadFlags(argument.split(/\s+/).filter(Boolean)).flags);
    return true;
  },
  use: useProfileCommand,
  set: setCommand,
  unset: unsetCommand,
  where: whereCommand,
  export: exportCommand,
  save: saveCommand,
  analyse: analyseCommand,
  window: windowCommand,
  columns: columnsCommand,
  report: reportCommand,
  compare: async ({ app, state, argument }) => {
    const [before, after, ...extra] = argument.split(/\s+/).filter(Boolean);
    if (!before || !after || extra.length > 0) {
      app.reporter.warn(
        'Usage: compare <before.xlsx> <after.xlsx>   (type: compare ? for how it works)',
      );
      return true;
    }
    await runCompare({
      beforePath: before,
      afterPath: after,
      outDir: state.resolved.outDir,
      reporter: app.reporter,
    });
    return true;
  },
  doctor: async ({ app, state }) => {
    await runDoctor({
      configPath: app.configPath,
      profileOverride: app.profileOverride ?? state.resolved.profileName,
      reporter: app.reporter,
      now: new Date(),
    });
    return true;
  },
};

const HELP_REQUESTS: ReadonlySet<string> = new Set(['?', '--help', '-h', 'help']);

/** Prints the card for a command, or says which commands have one. */
function showHelpCard(app: AppContext, name: string): void {
  const card = SESSION_HELP[name];
  if (!card) {
    app.reporter.warn(`No help for "${name}". Type "help" to see the commands.`);
    return;
  }
  for (const line of card) app.reporter.note(line);
}

/** True for "where ?", "window --help" and "? where": the user is asking about the command, not running it. */
function helpTarget(line: string): string | undefined {
  const words = line.trim().toLowerCase().split(/\s+/);
  const [first = '', second = ''] = words;
  const askedAfter = words.length === 2 && HELP_REQUESTS.has(second) && second !== 'help';
  if (askedAfter && SESSION_HELP[first]) return first;
  if (first === '?' && second !== '' && words.length === 2) return second;
  return undefined;
}

/** A line that starts like a shell command is run as the session commands that do the same. */
function looksLikeShellCommand(line: string): boolean {
  const first = line.trimStart().split(/\s/)[0]?.toLowerCase() ?? '';
  return first === brand.command || first === 'feedback';
}

async function runShellLine(app: AppContext, state: SessionState, line: string): Promise<boolean> {
  const translation = translateShellLine(line);
  if (!translation) return true;
  if (translation.kind === 'say') {
    app.reporter.warn(translation.message);
    return true;
  }
  app.reporter.info(
    `That is a shell command. In the session it is: ${translation.steps.join('  then  ')}`,
  );
  for (const step of translation.steps) {
    if (!(await runCommand(app, state, step))) return false;
  }
  return true;
}

/** The names a filter can start with, so a field like `rating` is never mistaken for a typo. */
const FILTER_FIELD_NAMES: ReadonlySet<string> = new Set(
  buildFields(DEFAULT_CONVENTIONS.reasons).map((field) => field.name),
);

/** One bare word that is neither a command nor a filter field: almost certainly a mistyped command. */
export function looksLikeMistypedCommand(line: string): boolean {
  const word = line.trim();
  return /^[A-Za-z_][\w-]*$/.test(word) && !FILTER_FIELD_NAMES.has(word.toLowerCase());
}

async function runCommand(app: AppContext, state: SessionState, line: string): Promise<boolean> {
  if (looksLikeShellCommand(line)) return runShellLine(app, state, line);
  const asked = helpTarget(line);
  if (asked) {
    showHelpCard(app, asked);
    return true;
  }
  const [command = '', ...rest] = line.split(/\s+/);
  const isFilter = isFilterLine(line);
  if (isFilter && looksLikeMistypedCommand(line)) {
    app.reporter.warn(
      `"${command}" is not a command or a filter field.${didYouMean(command.toLowerCase(), [...COMMAND_NAMES])} Type help for the commands, or fields for the filter fields.`,
    );
    return true;
  }
  const name = isFilter ? 'where' : command.toLowerCase();
  const handler = COMMANDS[name];
  if (!handler) {
    app.reporter.warn(`Unknown command "${command}". Type "help" to see what is available.`);
    return true;
  }
  const argument = (isFilter ? line : rest.join(' ')).trim();
  return handler({ app, state, argument });
}

/** The interactive editor draws with cursor moves and reads single keys, so it needs a terminal on both ends. */
export function interactiveTerminalProblem(
  streams: { stdinIsTty: boolean; stdoutIsTty: boolean } = {
    stdinIsTty: process.stdin.isTTY,
    stdoutIsTty: process.stdout.isTTY,
  },
): string | undefined {
  if (streams.stdinIsTty && streams.stdoutIsTty) return undefined;
  return `The interactive session needs a terminal for input and output. In a pipe or CI use a command instead, for example: ${brand.command} feedback export --dry-run`;
}

/** The prompt names the profile, so it is always clear which Langfuse is being read. */
export function promptFor(state: Pick<SessionState, 'resolved'>): string {
  return `${promptWord(brand)}[${state.resolved.profileName}]> `;
}

/** The interactive session: banner, auto-load, then a prompt with live hints. */
export async function runSession(app: AppContext): Promise<void> {
  if (refuseInDemo(app, 'The interactive session')) return;
  const problem = interactiveTerminalProblem();
  if (problem) {
    app.reporter.warn(problem);
    process.exitCode = 1;
    return;
  }
  const state: SessionState = {
    resolved: await resolveRun(app, app.window),
    dataset: undefined,
    columns: [...DEFAULT_TABLE_COLUMNS],
    lastQuery: undefined,
    docsHistory: [],
    window: { from: app.window.from, to: app.window.to },
  };
  printBanner(app, state.resolved, SESSION_COMMANDS.slice(0, 6));
  await reload(app, state);
  const historyPath = historyPathFor(app.configPath);
  const history: string[] = loadHistory(historyPath);
  process.stderr.write(
    '\nType a command, or just start typing a filter. Suggestions appear as you type: ↑/↓ choose, Tab or Enter accepts, Esc clears.\n',
  );
  showSoulInvite(app);

  for (;;) {
    const { profiles } = listProfilesSync(app.configPath);
    const line = await readLine({
      prompt: promptFor(state),
      promptColor: isProduction(state.resolved.profileName, state.dataset?.project.name)
        ? 'red'
        : 'amber',
      history,
      color: app.color,
      hints: (text) =>
        suggestForLine(text, {
          context: state.dataset?.context ?? { now: new Date() },
          profiles: profiles.map((profile) => profile.name),
          rows: state.dataset?.rows,
          reportsDir: state.resolved.outDir,
        }),
    });
    if (line === undefined) return;
    if (line.trim() === '') continue;
    saveHistoryLine(historyPath, line);
    try {
      if (!(await runCommand(app, state, line.trim()))) return;
    } catch (err) {
      app.reporter.cancel();
      app.reporter.warn(err instanceof Error ? err.message : String(err));
    }
  }
}
