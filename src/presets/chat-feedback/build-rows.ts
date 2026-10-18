import type { Conventions } from '../../config/config-schema.js';
import type { FeedbackRow } from '../../dsl/types.js';
import type { LangfuseScore, LangfuseTurn } from '../../langfuse/langfuse-client.js';
import { groupBy } from './group-by.js';

export interface ExportRow extends FeedbackRow {
  /** Position of the rated answer among the conversation's answers, oldest first (1 = first). */
  turnNumber: number;
  ratedUser: string;
  ratedAssistant: string;
  conversationTurns: number;
  /** Full conversation as "[n] User: … / Assistant: …" blocks, rated turn marked. */
  conversation: string;
}

/** The parts of the conventions that decide how scores are read. */
type ScoreNames = Pick<Conventions, 'ratingScore' | 'reasonScorePrefix' | 'yesValues' | 'reasons'>;

export interface BuildInput {
  /** Feedback scores recorded on a turn (observation-level). */
  scores: readonly LangfuseScore[];
  /** Every turn of each conversation, keyed by session id. */
  conversations: ReadonlyMap<string, readonly LangfuseTurn[]>;
  names: ScoreNames;
}

export interface BuildResult {
  rows: ExportRow[];
  /** Thumbs whose turn Langfuse did not return, so they cannot be shown with their text. */
  missingTurns: number;
}

/**
 * Langfuse observation ids are only unique within a trace, so a turn is always identified by the
 * trace and the observation together. Keying on the observation id alone could pair a rating
 * with another trace's customer text.
 */
export function turnKey(traceId: string, observationId: string): string {
  return `${traceId}\u0000${observationId}`;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function byStart(a: LangfuseTurn, b: LangfuseTurn): number {
  return a.startTime.localeCompare(b.startTime);
}

function isSameTurn(a: LangfuseTurn, b: LangfuseTurn): boolean {
  return a.id === b.id && a.traceId === b.traceId;
}

function renderConversation(turns: readonly LangfuseTurn[], rated: LangfuseTurn): string {
  return turns
    .map((turn, index) => {
      const marker = isSameTurn(turn, rated) ? ' ◀ RATED' : '';
      return `[${index + 1}]${marker}\nUser: ${asText(turn.input)}\nAssistant: ${asText(turn.output)}`;
    })
    .join('\n\n');
}

/** A score value counts as yes when it is `true` or one of the configured yes values (default 1). */
function isYes(value: LangfuseScore['value'], yesValues: readonly string[]): boolean {
  return yesValues.includes(String(value).toLowerCase());
}

/** Ticked reasons: the sibling reason scores on the same turn whose value is yes, minus the prefix. */
function categoryChips(turnScores: readonly LangfuseScore[], names: ScoreNames): string[] {
  const yes = names.yesValues.map((value) => value.toLowerCase());
  return turnScores
    .filter((score) => score.name !== names.ratingScore && isYes(score.value, yes))
    .map((score) => score.name.slice(names.reasonScorePrefix.length));
}

interface RowParts {
  helpful: LangfuseScore;
  turn: LangfuseTurn;
  categories: string[];
  conversation: readonly LangfuseTurn[];
  yesValues: readonly string[];
}

function toExportRow({ helpful, turn, categories, conversation, yesValues }: RowParts): ExportRow {
  const ordered = [...conversation].sort(byStart);
  return {
    traceId: turn.traceId,
    sessionId: turn.sessionId ?? '',
    observationId: turn.id,
    rating: isYes(
      helpful.value,
      yesValues.map((value) => value.toLowerCase()),
    )
      ? 'positive'
      : 'negative',
    categories,
    comment: helpful.comment ?? '',
    environment: turn.environment,
    created: Date.parse(helpful.timestamp),
    userId: turn.userId ?? '',
    turnNumber: ordered.findIndex((candidate) => isSameTurn(candidate, turn)) + 1,
    ratedUser: asText(turn.input),
    ratedAssistant: asText(turn.output),
    conversationTurns: ordered.length,
    conversation: renderConversation(ordered, turn),
  };
}

interface RatedTurn {
  turn: LangfuseTurn;
  conversation: readonly LangfuseTurn[];
}

/** Looks every turn up by trace and id once, so finding a rated turn costs the same however many conversations there are. */
function indexTurns(
  conversations: ReadonlyMap<string, readonly LangfuseTurn[]>,
): Map<string, RatedTurn> {
  const index = new Map<string, RatedTurn>();
  for (const conversation of conversations.values()) {
    for (const turn of conversation)
      index.set(turnKey(turn.traceId, turn.id), { turn, conversation });
  }
  return index;
}

function scoreTurnKey(score: LangfuseScore): string {
  return turnKey(score.subject?.traceId ?? '', score.subject?.id ?? '');
}

/** The rating the user gave last on a turn: a changed mind replaces the earlier thumb, whatever order Langfuse lists them in. */
function latestRating(
  turnScores: readonly LangfuseScore[],
  ratingScore: string,
): LangfuseScore | undefined {
  return turnScores
    .filter((score) => score.name === ratingScore)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.id.localeCompare(a.id))
    .at(0);
}

/**
 * Rows made from the scores alone, with no customer text, session or user. Enough to count and to
 * filter on rating, reasons, environment, date, comment, trace and observation; not for an export.
 */
export function buildRowsFromScores({
  scores,
  names,
}: Pick<BuildInput, 'scores' | 'names'>): ExportRow[] {
  const byTurn = groupBy(
    scores.flatMap((score) => (score.subject?.kind === 'observation' ? [score] : [])),
    scoreTurnKey,
  );
  const rows: ExportRow[] = [];
  for (const turnScores of byTurn.values()) {
    const helpful = latestRating(turnScores, names.ratingScore);
    if (!helpful) continue;
    rows.push({
      traceId: helpful.subject?.traceId ?? '',
      sessionId: '',
      observationId: helpful.subject?.id ?? '',
      rating: isYes(
        helpful.value,
        names.yesValues.map((value) => value.toLowerCase()),
      )
        ? 'positive'
        : 'negative',
      categories: categoryChips(turnScores, names),
      comment: helpful.comment ?? '',
      environment: helpful.environment,
      created: Date.parse(helpful.timestamp),
      userId: '',
      turnNumber: 0,
      ratedUser: '',
      ratedAssistant: '',
      conversationTurns: 0,
      conversation: '',
    });
  }
  return rows.sort((a, b) => a.created - b.created);
}

/** One row per rating score, with its reasons taken from the sibling scores on the same turn. */
export function buildRows({ scores, conversations, names }: BuildInput): BuildResult {
  const byTurn = groupBy(
    scores.flatMap((score) => (score.subject?.kind === 'observation' ? [score] : [])),
    scoreTurnKey,
  );
  const turnsByKey = indexTurns(conversations);
  const rows: ExportRow[] = [];
  let missingTurns = 0;
  for (const [key, turnScores] of byTurn) {
    const helpful = latestRating(turnScores, names.ratingScore);
    if (!helpful) continue;
    const found = turnsByKey.get(key);
    if (!found) {
      missingTurns++;
      continue;
    }
    rows.push(
      toExportRow({
        helpful,
        categories: categoryChips(turnScores, names),
        yesValues: names.yesValues,
        ...found,
      }),
    );
  }
  return { rows: rows.sort((a, b) => a.created - b.created), missingTurns };
}
