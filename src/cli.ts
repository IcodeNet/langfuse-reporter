import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brand } from './brand/brand.js';
import { runCompare } from './compare/run-compare.js';
import { runDoctor } from './app/run-doctor.js';
import { runSoul } from './app/run-soul.js';
import { newEnvFileWarning } from './config/path-warnings.js';
import { showReport } from './pager/show-report.js';
import { didYouMean } from './dsl/suggest.js';
import { COMMAND_HELP, MAX_HELP_LINES } from './help/command-help.js';
import { writtenFileRows } from './app/written-files.js';
import { checkOutDir } from './output/check-out-dir.js';
import { Command } from 'commander';
import {
  createAppContext,
  loadAppConfig,
  printBanner,
  refuseInDemo,
  resolveRun,
  type AppContext,
} from './app/app-context.js';
import { loadDataset } from './app/load-dataset.js';
import { runAnalyse } from './app/run-analyse.js';
import { runDocs } from './app/run-docs.js';
import { compileWhere, runExport } from './app/run-export.js';
import { createMasker } from './output/mask.js';
import {
  describeOutcome,
  overallExit,
  runSavedQuery,
  type QueryOutcome,
} from './queries/run-query.js';
import { buildSavedQuery, withQuery, withoutQuery } from './queries/saved-queries.js';
import { maskRows } from './presets/chat-feedback/mask-rows.js';
import { matches } from './dsl/evaluate.js';
import { formatRows, isOutputFormat } from './presets/chat-feedback/format-rows.js';
import { settingRows } from './config/config-report.js';
import {
  checkConfigFile,
  defaultConfigPath,
  listProfilesSync,
  loadConfigFile,
  saveConfigFile,
  setConfigValue,
  unsetConfigValue,
  useProfile,
} from './config/config-store.js';
import { DEFAULT_CONFIG, SETTABLE_KEYS, type ConfigFile } from './config/config-schema.js';
import { applyToProfile } from './config/apply-to-profile.js';
import { complete } from './dsl/complete.js';
import { describeFields } from './dsl/describe-fields.js';
import { buildFields, fieldsOf } from './dsl/fields.js';
import { runSession } from './session/run-session.js';

interface GlobalOptions {
  config: string;
  profile?: string;
  demo?: boolean;
}

interface ReportOptions {
  from?: string;
  to?: string;
  where?: string;
  format?: string;
  mask?: boolean;
  yes?: boolean;
  forceLarge?: boolean;
}

interface ExportOptions {
  from?: string;
  to?: string;
  where?: string;
  out?: string;
  format?: string;
  mask?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  forceLarge?: boolean;
}

function appFor(program: Command): AppContext {
  const { config, profile, demo } = program.opts<GlobalOptions>();
  return createAppContext(config, profile, {}, demo === true);
}

async function changeConfig(
  program: Command,
  change: (file: ConfigFile) => ConfigFile,
  describe: string,
): Promise<void> {
  const app = appFor(program);
  if (refuseInDemo(app, describe)) return;
  const task = app.reporter.task(describe, 'save');
  let before: ConfigFile;
  try {
    before = await loadConfigFile(app.configPath);
    await saveConfigFile(app.configPath, applyToProfile(before, app.profileOverride, change));
  } catch (err) {
    task.fail(`${describe}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  task.succeed(`${describe}: saved to ${app.configPath}`);
  const saved = await loadConfigFile(app.configPath);
  const problem = newEnvFileWarning(before, saved, app.profileOverride ?? saved.activeProfile);
  if (problem) app.reporter.warn(problem);
  printBanner(app, await resolveRun(app));
}

/** Stops a run before it downloads anything when the files could not be written afterwards. */
async function outDirIsUsable(app: AppContext, outDir: string): Promise<boolean> {
  const problem = await checkOutDir(outDir);
  if (!problem) return true;
  app.reporter.warn(problem);
  process.exitCode = 1;
  return false;
}

async function exportCommand(program: Command, options: ExportOptions): Promise<void> {
  const app = appFor(program);
  if (options.format !== undefined && !isOutputFormat(options.format)) {
    app.reporter.warn(
      `"${options.format}" is not a format. Use --format json or --format csv, or leave it out to write Excel files.`,
    );
    process.exitCode = 1;
    return;
  }
  const resolved = await resolveRun(app, {
    from: options.from,
    to: options.to,
    outDir: options.out,
  });
  printBanner(app, resolved);
  if (!options.dryRun && !(await outDirIsUsable(app, resolved.outDir))) return;
  const dataset = await loadDataset(resolved, app.reporter, {
    where: options.where,
    yes: options.yes,
    forceLarge: options.forceLarge,
    dryRun: options.dryRun,
  });
  const paths = await runExport({
    dataset,
    resolved,
    reporter: app.reporter,
    where: options.where,
    dryRun: options.dryRun,
    format: options.format,
    mask: options.mask,
  });
  if (paths) {
    app.reporter.block({
      title: 'Files written',
      emoji: '📁',
      rows: writtenFileRows(paths),
    });
  }
}

async function reportOneShot(program: Command, options: ReportOptions): Promise<void> {
  const app = appFor(program);
  if (options.format !== undefined && !isOutputFormat(options.format)) {
    app.reporter.warn(
      `"${options.format}" is not a format. Use --format json or --format csv, or leave it out to read the report on screen.`,
    );
    process.exitCode = 1;
    return;
  }
  const resolved = await resolveRun(app, { from: options.from, to: options.to });
  if (app.interactive && options.format === undefined) printBanner(app, resolved);
  const dataset = await loadDataset(resolved, app.reporter, {
    where: options.where,
    yes: options.yes,
    forceLarge: options.forceLarge,
  });
  if (options.format !== undefined && isOutputFormat(options.format)) {
    const expr = compileWhere(options.where, dataset);
    const matching = dataset.rows.filter((row) => matches(expr, row));
    const rows = options.mask === false ? matching : maskRows(matching, createMasker());
    process.stdout.write(formatRows(rows, options.format));
    return;
  }
  await showReport({
    dataset,
    resolved,
    reporter: app.reporter,
    where: options.where,
    color: app.color,
    columns: app.columns,
  });
}

async function docsCommand(program: Command, words: string[]): Promise<void> {
  const app = appFor(program);
  const resolved = await resolveRun(app);
  printBanner(app, resolved);
  await runDocs({ resolved, reporter: app.reporter, question: words.join(' ') });
}

function addDocsCommand(program: Command): void {
  program
    .command('docs [question...]')
    .description('ask anything about the CLI and how Langfuse must be set up for it')
    .action((words: string[]) => docsCommand(program, words));
}

async function analyseCommand(
  program: Command,
  options: {
    from?: string;
    to?: string;
    where?: string;
    out?: string;
    mask?: boolean;
    yes?: boolean;
    forceLarge?: boolean;
  },
): Promise<void> {
  const app = appFor(program);
  const resolved = await resolveRun(app, {
    from: options.from,
    to: options.to,
    outDir: options.out,
  });
  printBanner(app, resolved);
  if (!(await outDirIsUsable(app, resolved.outDir))) return;
  const dataset = await loadDataset(resolved, app.reporter, {
    where: options.where,
    yes: options.yes,
    forceLarge: options.forceLarge,
  });
  const written = await runAnalyse({
    dataset,
    resolved,
    reporter: app.reporter,
    where: options.where,
    yes: options.yes,
    mask: options.mask,
  });
  if (written === undefined) process.exitCode = 1;
}

function addCompareCommand(program: Command): void {
  program
    .command('compare <before> <after>')
    .description('compare two report files and write a three-sheet workbook')
    .option('--out <dir>', 'output directory')
    .action(async (before: string, after: string, options: { out?: string }) => {
      const app = appFor(program);
      const resolved = await resolveRun(app, { outDir: options.out });
      const written = await runCompare({
        beforePath: before,
        afterPath: after,
        outDir: resolved.outDir,
        reporter: app.reporter,
      });
      if (written === undefined) process.exitCode = 1;
    });
}

function addDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('check every link from config to ratings and print the fix for each')
    .action(async () => {
      const app = appFor(program);
      const failed = await runDoctor({
        configPath: app.configPath,
        demo: app.demo,
        profileOverride: app.profileOverride,
        reporter: app.reporter,
        now: new Date(),
      });
      if (failed > 0) process.exitCode = 1;
    });
}

function addSoulCommand(program: Command): void {
  program
    .command('soul')
    .description('a picture-and-words tour of what this tool does and how anyone can use it')
    .action(() => runSoul(appFor(program)));
}

function collectRule(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addQueryCommands(program: Command): void {
  const query = program
    .command('query')
    .description('saved queries with rules, for CI: exit 0 pass, 1 rule failed, 2 could not check');
  query
    .command('save <name>')
    .description('save a filter, a window and rules under a name in the config file')
    .option('--where <filter>', 'filter, same language as --where elsewhere')
    .option(
      '--window <word>',
      'today, yesterday, 7d (any number of days), this-week, last-week, this-month, last-month',
    )
    .option('--rule <rule>', 'e.g. "negative-rate <= 0.2"; repeat for more rules', collectRule, [])
    .action(async (name: string, options: { where?: string; window?: string; rule: string[] }) => {
      const app = appFor(program);
      if (refuseInDemo(app, 'query save')) return;
      const file = await loadConfigFile(app.configPath);
      const built = buildSavedQuery(
        name,
        { where: options.where, window: options.window, rules: options.rule },
        file.conventions,
      );
      if ('problems' in built) {
        for (const problem of built.problems) app.reporter.warn(problem);
        process.exitCode = 2;
        return;
      }
      await saveConfigFile(app.configPath, withQuery(file, name, built.query));
      app.reporter.info(`Saved query "${name}" to ${app.configPath}`);
    });
  query
    .command('list')
    .description('list the saved queries')
    .action(async () => {
      const app = appFor(program);
      const file = await loadAppConfig(app);
      const names = Object.keys(file.queries);
      if (names.length === 0) {
        app.reporter.info('No saved queries. Add one with: query save <name> --rule "count >= 1"');
        return;
      }
      app.reporter.block({
        title: 'Saved queries',
        emoji: '🔖',
        rows: names.map((name) => {
          const saved = file.queries[name];
          const parts = [
            saved?.window ?? 'last-month',
            saved?.where ? `where ${saved.where}` : 'all ratings',
            ...(saved?.rules ?? []),
          ];
          return [name, parts.join(' | ')] as const;
        }),
      });
    });
  query
    .command('remove <name>')
    .description('delete a saved query from the config file')
    .action(async (name: string) => {
      const app = appFor(program);
      if (refuseInDemo(app, 'query remove')) return;
      try {
        const file = await loadConfigFile(app.configPath);
        await saveConfigFile(app.configPath, withoutQuery(file, name));
        app.reporter.info(`Removed query "${name}"`);
      } catch (err) {
        app.reporter.warn(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      }
    });
  query
    .command('run [name]')
    .description('check the rules of one saved query, or of every one with --all')
    .option('--all', 'run every saved query')
    .option('--json', 'print the result as JSON on the screen instead of text')
    .option('--yes', 'go ahead with a large run (over 5000 ratings) without stopping')
    .action(
      async (
        name: string | undefined,
        options: { all?: boolean; json?: boolean; yes?: boolean },
      ) => {
        const app = appFor(program);
        let outcomes: QueryOutcome[];
        try {
          const file = await loadAppConfig(app);
          const names = options.all ? Object.keys(file.queries) : name ? [name] : [];
          if (names.length === 0) {
            app.reporter.warn(
              options.all
                ? 'There are no saved queries to run.'
                : 'Say which query to run (query run <name>), or use --all.',
            );
            process.exitCode = 2;
            return;
          }
          outcomes = [];
          for (const each of names) {
            outcomes.push(
              await runSavedQuery({
                name: each,
                config: file,
                profileOverride: app.profileOverride,
                reporter: app.reporter,
                yes: options.yes,
              }),
            );
          }
        } catch (err) {
          app.reporter.warn(err instanceof Error ? err.message : String(err));
          process.exitCode = 2;
          return;
        }
        const exit = overallExit(outcomes);
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ exit, queries: outcomes }, null, 2)}\n`);
        } else {
          for (const outcome of outcomes)
            process.stdout.write(`${describeOutcome(outcome).join('\n')}\n`);
        }
        process.exitCode = exit;
      },
    );
}

function addAnalyseCommand(program: Command): void {
  program
    .command('analyse')
    .description('ask a model for the common problems in the feedback, and write them to Excel')
    .option('--from <iso>', 'window start (default: first day of last month, UTC)')
    .option('--to <iso>', 'window end, exclusive (default: first day of this month, UTC)')
    .option(
      '--where <filter>',
      'only analyse ratings matching this filter, e.g. "rating = negative"',
    )
    .option('--out <dir>', 'output directory')
    .option('--no-mask', 'send user ids and personal details to the model')
    .option('--yes', 'send more than 600 ratings to the model, or run a large window')
    .option('--force-large', 'try a window that would be refused as too large for this machine')
    .action((options) => analyseCommand(program, options));
}

function addConfigCommands(program: Command): void {
  const configCommand = program
    .command('config')
    .description('show or change the saved configuration');
  configCommand
    .command('show')
    .description('print the resolved configuration')
    .action(async () => {
      const app = appFor(program);
      const resolved = await resolveRun(app);
      printBanner(app, resolved);
      app.reporter.block({
        title: 'Settings (change with config set <key> <value>, or edit the file)',
        emoji: '🛠️ ',
        rows: settingRows(await loadAppConfig(app), resolved.profileName),
      });
    });
  configCommand
    .command('check')
    .description('check the config file and report every wrong value, with where it is')
    .action(async () => {
      const app = appFor(program);
      if (refuseInDemo(app, 'config check')) return;
      const result = await checkConfigFile(app.configPath);
      if (result.problems.length > 0) {
        app.reporter.warn(`The config file ${app.configPath} has problems:`);
        for (const problem of result.problems) app.reporter.note(`  - ${problem}`);
        process.exitCode = 1;
        return;
      }
      app.reporter.done(
        result.missing
          ? `No config file yet at ${app.configPath}; the defaults apply. Run: ${brand.command} config init`
          : `The config file ${app.configPath} is valid`,
      );
    });
  configCommand
    .command('init')
    .description('write the config file with every default value, ready to edit by hand')
    .action(async () => {
      const app = appFor(program);
      if (refuseInDemo(app, 'config init')) return;
      const existing = await checkConfigFile(app.configPath);
      if (!existing.missing) {
        app.reporter.warn(
          `${app.configPath} already exists. Edit it, or run: ${brand.command} config check`,
        );
        process.exitCode = 1;
        return;
      }
      await saveConfigFile(app.configPath, DEFAULT_CONFIG);
      app.reporter.done(
        `Wrote ${app.configPath} with the defaults. Edit it, then run: ${brand.command} config check`,
      );
    });
  configCommand
    .command('set <key> <value>')
    .description(
      `set one of: ${SETTABLE_KEYS.join(', ')} (profile.* applies to the active profile)`,
    )
    .action((key: string, value: string) =>
      changeConfig(program, (file) => setConfigValue(file, key, value), `Setting ${key}`),
    );
  configCommand
    .command('unset <key>')
    .description('reset a key to its default')
    .action((key: string) =>
      changeConfig(program, (file) => unsetConfigValue(file, key), `Resetting ${key}`),
    );
  configCommand
    .command('use <profile>')
    .description('switch the active profile, creating it with --base-url when new')
    .option('--base-url <url>', 'Langfuse URL for a new profile')
    .action((name: string, options: { baseUrl?: string }) =>
      changeConfig(
        program,
        (file) => useProfile(file, name, options.baseUrl),
        `Switching to profile "${name}"`,
      ),
    );
}

function addFeedbackCommands(program: Command): void {
  const feedback = program.command('feedback').description('user feedback (thumbs) queries');
  feedback
    .command('export')
    .description('write positive and negative feedback to two files (Excel, CSV or JSON)')
    .option('--from <iso>', 'window start (default: first day of last month, UTC)')
    .option('--to <iso>', 'window end, exclusive (default: first day of this month, UTC)')
    .option(
      '--where <filter>',
      'filter DSL, e.g. "rating = negative AND category IN (other_issue)"',
    )
    .option('--out <dir>', 'output directory')
    .option('--format <name>', 'write json or csv files instead of Excel')
    .option('--no-mask', 'keep user ids and personal details in the files')
    .option('--dry-run', 'count matches without writing files')
    .option('--yes', 'go ahead with a large run (over 5000 ratings) without stopping')
    .option('--force-large', 'try a run that would be refused as too large for this machine')
    .action((options: ExportOptions) => exportCommand(program, options));
  feedback
    .command('report')
    .description('read the ratings full screen, like less')
    .option('--from <iso>', 'window start (default: first day of last month, UTC)')
    .option('--to <iso>', 'window end, exclusive (default: first day of this month, UTC)')
    .option('--where <filter>', 'only show ratings matching this filter')
    .option('--format <name>', 'print json or csv to stdout instead of the full-screen reader')
    .option('--no-mask', 'keep user ids and personal details in the printed rows')
    .option('--yes', 'go ahead with a large run (over 5000 ratings) without stopping')
    .option('--force-large', 'try a run that would be refused as too large for this machine')
    .action((options: ReportOptions) => reportOneShot(program, options));
  feedback
    .command('shell')
    .description(`open the interactive session (same as running ${brand.command} with no command)`)
    .action(() => runSession(appFor(program)));
  feedback
    .command('suggest <partial>')
    .description('print what can come next after a partial filter (no network)')
    .action((partial: string) => {
      const { suggestions } = complete(partial, { now: new Date() });
      appFor(program).reporter.block({
        title: 'What can come next',
        emoji: '💡',
        rows: suggestions.map((s) => [s.insert, s.hint] as const),
      });
    });
  feedback
    .command('fields')
    .description('list filter fields, operators and valid values')
    .action(async () => {
      const app = appFor(program);
      const resolved = await resolveRun(app);
      app.reporter.block({
        title: 'Filter fields',
        emoji: '🧩',
        rows: describeFields(fieldsOf({ fields: buildFields(resolved.conventions.reasons) })),
      });
    });
}

/** Replaces commander's generated help with the short card for each command, so every --help is at most 10 lines. */
function attachHelpCards(command: Command, path: string[] = []): void {
  const card = COMMAND_HELP[path.join(' ')];
  if (card) command.helpInformation = () => `${card.join('\n')}\n`;
  for (const child of command.commands) attachHelpCards(child, [...path, child.name()]);
}

/** The program's own card ends with the profile names, so a wrong --profile can be fixed from the help. */
function profileLine(configPath: string): string {
  const { activeProfile, profiles } = listProfilesSync(configPath);
  const names = profiles.map((profile) =>
    profile.name === activeProfile ? `${profile.name}*` : profile.name,
  );
  return `Profiles (* active): ${names.join(', ')}`;
}

/** The commands typed straight after the program name, for suggesting the nearest one after a typo. */
const TOP_LEVEL_COMMANDS = [
  'feedback',
  'config',
  'docs',
  'analyse',
  'query',
  'compare',
  'doctor',
  'soul',
];

/**
 * Commander's own wording for a mistyped command or a missing argument names no way out. This adds
 * the closest command and the help command to try, keeping the original line first.
 */
export function explainUsageError(
  text: string,
  commands: readonly string[] = TOP_LEVEL_COMMANDS,
): string {
  const message = text.trim().split('\n')[0] ?? '';
  const unknown = /unknown command '([^']+)'|too many arguments.*?: (\S+)\./.exec(message);
  const typed = unknown?.[1] ?? unknown?.[2];
  const missing = /missing required argument '([^']+)'/.exec(message);
  if (typed !== undefined) {
    const guess = didYouMean(typed.toLowerCase(), commands);
    return `${message}${guess}\nSee the commands with: ${brand.command} --help\n`;
  }
  if (missing) return `${message}\nSee how it is used with: ${brand.command} <command> --help\n`;
  return text;
}

/** Applies the clearer usage errors to a command and all of its subcommands. */
function explainUsageErrors(command: Command): void {
  command.configureOutput({ outputError: (text, write) => write(explainUsageError(text)) });
  for (const child of command.commands) explainUsageErrors(child);
}

/** The version in package.json, read at start so there is one place to change it. */
export function packageVersion(): string {
  const text = readFileSync(join(import.meta.dirname, '../package.json'), 'utf8');
  return (JSON.parse(text) as { version: string }).version;
}

export function buildProgram(argv: readonly string[] = process.argv): Command {
  const configFlag = argv.findIndex((arg) => arg === '--config');
  const configPath = (configFlag === -1 ? undefined : argv[configFlag + 1]) ?? defaultConfigPath();
  const program = new Command(brand.command)
    .description(`${brand.name}: query Langfuse user feedback and export it to Excel`)
    .showHelpAfterError('(run with --help to see usage)')
    .version(packageVersion(), '-V, --version', 'print the version and stop')
    .option('--config <path>', 'config file', defaultConfigPath())
    .option('--demo', 'use built-in sample data; no Langfuse account, keys or config file needed')
    .option(
      '--profile <name>',
      'use this profile for the run instead of the active one (names are listed below)',
    )
    .action(() => runSession(appFor(program)));
  addConfigCommands(program);
  addFeedbackCommands(program);
  addDocsCommand(program);
  addAnalyseCommand(program);
  addQueryCommands(program);
  addDoctorCommand(program);
  addSoulCommand(program);
  addCompareCommand(program);
  attachHelpCards(program);
  explainUsageErrors(program);
  const rootCard = COMMAND_HELP[''] ?? [];
  program.helpInformation = () =>
    `${[...rootCard.slice(0, MAX_HELP_LINES - 1), profileLine(configPath)].join('\n')}\n`;
  return program;
}
