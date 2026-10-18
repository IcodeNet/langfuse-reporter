import { brand } from '../brand/brand.js';
import { isDemoBaseUrl } from '../demo/demo-constants.js';
import { createDemoFetch } from '../demo/demo-fetch.js';
import { buildSampleData } from '../demo/sample-data.js';
import { isProduction, productionWarning } from './production.js';
import { explainEmpty, type LoadNotes } from './explain-empty.js';
import { buildFields, isLangfuseOwnedEnvironment } from '../dsl/fields.js';
import { parseQuery } from '../dsl/parse.js';
import { serverFiltersFor, type ServerFilters } from '../dsl/server-filters.js';
import type { ParseContext } from '../dsl/types.js';
import {
  buildRows,
  buildRowsFromScores,
  turnKey,
  type ExportRow,
} from '../presets/chat-feedback/build-rows.js';
import {
  LangfuseClient,
  TurnBudgetError,
  type LangfuseProject,
  type LangfuseScore,
  type LangfuseTurn,
  type TurnScope,
  MAX_RETRIES,
} from '../langfuse/langfuse-client.js';
import type { Conventions } from '../config/config-schema.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { Reporter } from '../ui/reporter.js';
import { checkSize, turnBudgetFor } from './size-guard.js';
import { criteriaBlock, describeCriteria, summariseWindow } from './search-criteria.js';

/** The score names to ask Langfuse for: the rating, then one per reason, as the config names them. */
export function scoreNamesFor(conventions: Conventions): string[] {
  return [
    conventions.ratingScore,
    ...conventions.reasons.map((reason) => `${conventions.reasonScorePrefix}${reason}`),
  ];
}

export interface Dataset {
  /** The Langfuse project the rows came from. */
  project: LangfuseProject;
  rows: ExportRow[];
  /** What loading left out; explains an empty result. */
  notes: LoadNotes;
  context: ParseContext;
}

export function makeClient(resolved: ResolvedConfig, reporter: Reporter): LangfuseClient {
  if (resolved.envFileProblem) throw new Error(resolved.envFileProblem);
  if (!resolved.publicKey || !resolved.secretKey) {
    throw new Error(
      `Profile "${resolved.profileName}" has no Langfuse keys. LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY were not found in ${resolved.profile.envFile ?? 'the environment'}. Point the profile at an env file: ${brand.command} --profile ${resolved.profileName} config set profile.envFile <path>`,
    );
  }
  return new LangfuseClient({
    baseUrl: resolved.profile.baseUrl,
    publicKey: resolved.publicKey,
    secretKey: resolved.secretKey,
    turnName: resolved.conventions.turnName,
    fetchImpl: isDemoBaseUrl(resolved.profile.baseUrl)
      ? createDemoFetch(buildSampleData({ now: new Date(), conventions: resolved.conventions }))
      : undefined,
    onRetry: ({ status, attempt, delayMs }) =>
      reporter.warn(
        attempt === 1
          ? `Langfuse answered ${status}; retry ${attempt} in ${Math.ceil(delayMs / 1000)}s (it will try up to ${MAX_RETRIES} more times, about a minute in all; press Ctrl+C to stop)`
          : `Langfuse answered ${status}; retry ${attempt} in ${Math.ceil(delayMs / 1000)}s`,
      ),
  });
}

/** A score recorded on a turn, with the trace that turn belongs to. */
export type TurnScore = LangfuseScore & {
  subject: { kind: 'observation'; id: string; traceId: string };
};

export function isOnTurn(score: LangfuseScore): score is TurnScore {
  return score.subject?.kind === 'observation' && Boolean(score.subject.traceId);
}

function distinct(rows: readonly ExportRow[], pick: (row: ExportRow) => string): string[] {
  return [...new Set(rows.map(pick).filter(Boolean))].sort();
}

/** Environments the project has used, so `env = ...` can be checked before any rating is loaded. */
async function knownEnvironments(
  client: LangfuseClient,
  reporter: Reporter,
  now: Date,
): Promise<string[]> {
  try {
    return await client.listEnvironments(now);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    reporter.warn(
      `Could not list the project's environments (${reason}); env values come from the loaded ratings only`,
    );
    return [];
  }
}

export interface LoadOptions {
  /** The filter the caller will apply afterwards; shown in the criteria, not used for fetching. */
  where?: string;
  /** Go ahead with a large run without being asked (`--yes`). */
  yes?: boolean;
  /** Try a run that would be refused as too large (`--force-large`). */
  forceLarge?: boolean;
  /** True inside the session, so the empty-result hint is a session command. */
  interactive?: boolean;
  /** A dry run only counts, so it reads no conversations when the filter does not need them. */
  dryRun?: boolean;
}

/** The filter fields that live on the conversation, not on the rating; a loose match only costs a full read. */
const CONVERSATION_FIELD = /\b(user|session)\b/i;

/** True when a dry run can count from the ratings alone, with no customer text downloaded. */
export function canCountWithoutConversations(options: LoadOptions): boolean {
  return options.dryRun === true && !CONVERSATION_FIELD.test(options.where ?? '');
}

/**
 * The trace and observation the filter pins down, so Langfuse sends only those scores. A filter
 * that does not parse is left for the normal error path after loading.
 */
function serverFiltersOf(resolved: ResolvedConfig, where: string | undefined): ServerFilters {
  if (!where?.trim()) return {};
  try {
    const expr = parseQuery(where, {
      now: new Date(),
      fields: buildFields(resolved.conventions.reasons),
    });
    return serverFiltersFor(expr);
  } catch {
    return {};
  }
}

/** Stops a run that is too big before any question or answer text is downloaded. */
function enforceSize(ratings: number, options: LoadOptions, reporter: Reporter): void {
  const check = checkSize({ ratings });
  if (check.verdict === 'refuse' && !options.forceLarge) throw new Error(check.advice);
  if (check.verdict === 'confirm' && !options.yes && !options.forceLarge)
    throw new Error(check.advice);
  if (check.verdict !== 'ok')
    reporter.warn(
      `Large run: ${check.ratings} ratings, roughly ${check.estimatedMb} MB. Going ahead as asked.`,
    );
}

interface LookupRequest {
  client: LangfuseClient;
  reporter: Reporter;
  scope: TurnScope;
  ids: readonly string[];
  /** Plain-words noun for the progress line, e.g. "rated answers". */
  what: string;
  /** Most turns the lookup may keep in memory. */
  maxTurns: number;
}

/** Looks the ids up with live progress; a partial result would make a partial export, so any failure stops the run. */
async function lookUpTurns({
  client,
  reporter,
  scope,
  ids,
  what,
  maxTurns,
}: LookupRequest): Promise<Map<string, LangfuseTurn[]>> {
  const failures: string[] = [];
  const label = (done: number): string => `Fetching ${ids.length} ${what}… ${done}/${ids.length}`;
  const task = reporter.task(label(0), 'conversations');
  let groups;
  try {
    groups = await client.getTurnGroups({
      scope,
      ids,
      maxTurns,
      onError: (id, err) =>
        failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`),
      onProgress: (done) => task.update(label(done)),
    });
  } catch (err) {
    if (!(err instanceof TurnBudgetError)) throw err;
    task.fail(`Stopped after ${err.turnsRead} turns`);
    throw new Error(
      `These conversations hold more than ${err.maxTurns} turns, far more than the ${ids.length} ${what} suggested, so the run was stopped before it used up memory. Choose a shorter window (window <from> <to>, or --from and --to), or add --force-large to read them anyway.`,
      { cause: err },
    );
  }
  if (failures.length > 0) {
    task.fail(`Could not fetch ${failures.length}/${ids.length} ${what}`);
    throw new Error(
      `The export would be incomplete, so nothing was written:\n${failures.join('\n')}`,
    );
  }
  task.succeed(`Fetched ${ids.length} ${what}`);
  return groups;
}

/** Turns without a session cannot be grouped by conversation, so each stands alone under its own key. */
function conversationsOf(
  ratedTurns: readonly LangfuseTurn[],
  sessions: ReadonlyMap<string, LangfuseTurn[]>,
): Map<string, LangfuseTurn[]> {
  const conversations = new Map(sessions);
  for (const turn of ratedTurns) {
    if (!turn.sessionId) conversations.set(`turn:${turnKey(turn.traceId, turn.id)}`, [turn]);
  }
  return conversations;
}

/** Every environment the project has plus those seen in the ratings: all of them are accepted in a filter. */
function allEnvironments(fromProject: readonly string[], rows: readonly ExportRow[]): string[] {
  return [...new Set([...fromProject, ...distinct(rows, (row) => row.environment)])].sort();
}

/**
 * The environments offered as suggestions: the project's own, without the ones Langfuse creates
 * for itself. A rating seen in a hidden environment brings it back, so what exists is never hidden.
 */
function environmentValues(
  fromProject: readonly string[],
  rows: readonly ExportRow[],
): { suggestedValues: { env: string[] } } {
  const seen = new Set(distinct(rows, (row) => row.environment));
  const offered = allEnvironments(fromProject, rows).filter(
    (name) => seen.has(name) || !isLangfuseOwnedEnvironment(name),
  );
  return { suggestedValues: { env: offered } };
}

interface CountOnlyRequest {
  client: LangfuseClient;
  resolved: ResolvedConfig;
  reporter: Reporter;
  project: LangfuseProject;
  scores: readonly LangfuseScore[];
  traceLevelRatings: number;
}

/** The dataset of a dry run: built from the scores alone, so no question or answer text is downloaded. */
async function countOnlyDataset({
  client,
  resolved,
  reporter,
  project,
  scores,
  traceLevelRatings,
}: CountOnlyRequest): Promise<Dataset> {
  const { conventions } = resolved;
  const rows = buildRowsFromScores({ scores, names: conventions });
  reporter.info(
    'Dry run: counted from the ratings alone, no conversations were read. A rating whose answer Langfuse no longer returns would only show up in a real run.',
  );
  const notes: LoadNotes = { traceLevelRatings, missingTurns: 0, countedFromRatingsOnly: true };
  const now = new Date();
  for (const line of explainEmpty({
    rowCount: rows.length,
    notes,
    resolved,
    now,
    interactive: false,
  }))
    reporter.warn(line);
  const environments = await knownEnvironments(client, reporter, now);
  return {
    project,
    rows,
    notes,
    context: {
      now,
      fields: buildFields(conventions.reasons),
      ...environmentValues(environments, rows),
      dynamicValues: {
        env: allEnvironments(environments, rows),
        user: [],
      },
    },
  };
}

/** Loads every rated answer in the window and reports each step as it happens. */
export async function loadDataset(
  resolved: ResolvedConfig,
  reporter: Reporter,
  options: LoadOptions = {},
): Promise<Dataset> {
  const client = makeClient(resolved, reporter);
  const projectTask = reporter.task('Checking which Langfuse project these keys open', 'connect');
  const project = await client.getProject();
  projectTask.succeed(`Project: ${project.name} (${project.id})`);
  if (isProduction(resolved.profileName, project.name)) {
    reporter.warn(productionWarning(resolved.profileName, project.name));
  }
  reporter.block(criteriaBlock(describeCriteria(resolved, options.where, project.name)));

  const { conventions } = resolved;
  const scoresTask = reporter.task(
    `Counting ratings given ${summariseWindow(resolved)} from ${resolved.profile.baseUrl}`,
    'fetch',
  );
  const serverFilters = serverFiltersOf(resolved, options.where);
  const allRatingScores = await client.listScores({
    names: [conventions.ratingScore],
    from: resolved.from,
    to: resolved.to,
    fields: 'subject',
    ...serverFilters,
    onPage: (total) =>
      scoresTask.update(`Counting ratings given ${summariseWindow(resolved)}… ${total} so far`),
  });
  const ratingScores = allRatingScores.filter(isOnTurn);
  const traceLevelRatings = allRatingScores.length - ratingScores.length;
  const traceIds = [...new Set(ratingScores.map((score) => score.subject.traceId))];
  scoresTask.succeed(
    `Found ${ratingScores.length} ratings on ${traceIds.length} traces (${summariseWindow(resolved)})`,
  );

  enforceSize(ratingScores.length, options, reporter);
  const detailsTask = reporter.task('Reading the reasons and comments of those ratings', 'fetch');
  const scores = (
    await client.listScores({
      names: scoreNamesFor(conventions),
      from: resolved.from,
      to: resolved.to,
      ...serverFilters,
    })
  ).filter(isOnTurn);
  detailsTask.succeed(`Read ${scores.length} scores (ratings, reasons and comments)`);

  if (canCountWithoutConversations(options)) {
    return countOnlyDataset({ client, resolved, reporter, project, scores, traceLevelRatings });
  }
  if (options.dryRun) {
    reporter.info(
      'This filter uses the user or session, which are only on the conversation, so the conversations are read to count.',
    );
  }

  const maxTurns = options.forceLarge
    ? Number.POSITIVE_INFINITY
    : turnBudgetFor(ratingScores.length);
  const traces = await lookUpTurns({
    client,
    reporter,
    scope: 'trace',
    ids: traceIds,
    what: 'rated traces',
    maxTurns,
  });
  const ratedKeys = new Set(
    ratingScores.map((score) => turnKey(score.subject.traceId, score.subject.id)),
  );
  const ratedTurns = [...traces.values()]
    .flat()
    .filter((turn) => ratedKeys.has(turnKey(turn.traceId, turn.id)));
  const sessionIds = [
    ...new Set(ratedTurns.flatMap((turn) => (turn.sessionId ? [turn.sessionId] : []))),
  ];
  const sessions = await lookUpTurns({
    client,
    reporter,
    scope: 'session',
    ids: sessionIds,
    what: 'conversations',
    maxTurns,
  });

  const buildTask = reporter.task('Putting each rating with the answer it was given on', 'match');
  const { rows, missingTurns } = buildRows({
    scores,
    conversations: conversationsOf(ratedTurns, sessions),
    names: conventions,
  });
  buildTask.succeed(`Built ${rows.length} rows, one per rated answer`);
  if (missingTurns > 0) {
    reporter.warn(
      `${missingTurns} rating(s) point at an answer Langfuse no longer returns and were left out. Try a narrower window; if it persists, open the trace in Langfuse.`,
    );
  }

  const now = new Date();
  const notes: LoadNotes = { traceLevelRatings, missingTurns };
  for (const line of explainEmpty({
    rowCount: rows.length,
    notes,
    resolved,
    now,
    interactive: options.interactive === true,
  }))
    reporter.warn(line);
  const environments = await knownEnvironments(client, reporter, now);
  return {
    project,
    rows,
    notes,
    context: {
      now,
      fields: buildFields(conventions.reasons),
      ...environmentValues(environments, rows),
      dynamicValues: {
        env: allEnvironments(environments, rows),
        user: distinct(rows, (row) => row.userId),
      },
    },
  };
}
