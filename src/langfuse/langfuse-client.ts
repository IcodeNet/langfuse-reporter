import type { Profile } from '../config/config-schema.js';

/**
 * A feedback score. The app records each thumb on the `chat-turn` it rated, so `subject.kind` is
 * `observation` and `subject.id` is that turn's observation id.
 */
export interface LangfuseScore {
  id: string;
  name: string;
  value: number | string | boolean;
  comment: string | null;
  timestamp: string;
  updatedAt: string;
  environment: string;
  /** Absent on a score that is not attached to a trace, observation or session. */
  subject?: { kind: string; id: string; traceId?: string };
}

/** One customer question and the agent's answer: a `chat-turn` observation. */
export interface LangfuseTurn {
  id: string;
  traceId: string;
  sessionId: string | null;
  userId: string | null;
  environment: string;
  startTime: string;
  input?: unknown;
  output?: unknown;
}

interface TurnPage {
  data: LangfuseTurn[];
  meta?: { cursor?: string };
}

interface ScorePage {
  data: LangfuseScore[];
  meta?: { cursor?: string };
  cursor?: string;
}

interface RetryNotice {
  path: string;
  status: number;
  attempt: number;
  delayMs: number;
}

export interface LangfuseProject {
  id: string;
  name: string;
}

export interface LangfuseClientOptions {
  baseUrl: Profile['baseUrl'];
  publicKey: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
  /** Name of the observation that holds one question and answer. */
  turnName: string;
  /** Called before each backoff sleep so the UI can say why it is waiting. */
  onRetry?: (notice: RetryNotice) => void;
}

export interface ListScoresRequest {
  names: readonly string[];
  from: string;
  to: string;
  /** Which score fields to ask for. `subject` alone is enough to count and locate ratings; `details` adds comments. */
  fields?: 'subject' | 'details,subject';
  /** Only the scores of this trace; the filter is applied by Langfuse. */
  traceId?: string;
  /** Only the scores of this observation; Langfuse requires `traceId` with it. */
  observationId?: string;
  /** Called after each page with the running total. */
  onPage?: (total: number) => void;
}

/** What turns are looked up by: one conversation (session) or one trace. */
export type TurnScope = 'session' | 'trace';

export interface GetTurnGroupsRequest {
  scope: TurnScope;
  ids: readonly string[];
  /** A failed lookup is reported here instead of aborting the others. */
  onError: (id: string, error: unknown) => void;
  /** Called after each lookup settles with (done, total). */
  onProgress?: (done: number, total: number) => void;
  /** Most turns to hold in memory; the lookup stops with a TurnBudgetError when it is passed. */
  maxTurns?: number;
}

/** Raised when the conversations being read hold more turns than the run may keep in memory. */
export class TurnBudgetError extends Error {
  constructor(
    readonly turnsRead: number,
    readonly maxTurns: number,
  ) {
    super(`Read ${turnsRead} turns and stopped at the limit of ${maxTurns}`);
    this.name = 'TurnBudgetError';
  }
}

const SCORE_PAGE_SIZE = 100;
const TURN_PAGE_SIZE = 1000;
const LOOKUP_CONCURRENCY = 4;
const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 1_000;
const REQUEST_TIMEOUT_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Honours Retry-After (seconds) when the server sends it, else exponential backoff. */
export function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  return Number.isFinite(seconds) ? seconds * 1_000 : BASE_BACKOFF_MS * 2 ** attempt;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ENVIRONMENT_LOOKBACK_DAYS = 90;
const MAX_ENVIRONMENTS = 100;

export class LangfuseClient {
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LangfuseClientOptions) {
    this.authorization = `Basic ${Buffer.from(`${options.publicKey}:${options.secretKey}`).toString('base64')}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async getJson<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: this.authorization },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return (await response.json()) as T;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(`Langfuse ${path} failed: ${response.status} ${response.statusText}`);
      }
      const delayMs = retryDelayMs(response.headers.get('retry-after'), attempt);
      this.options.onRetry?.({ path, status: response.status, attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }

  /** The project the API keys belong to; a key pair opens exactly one. */
  async getProject(): Promise<LangfuseProject> {
    const page = await this.getJson<{ data: Array<{ id: string; name?: string }> }>(
      '/api/public/projects',
    );
    const [project] = page.data;
    if (!project) throw new Error('Langfuse returned no project for these API keys');
    return { id: project.id, name: project.name ?? project.id };
  }

  /**
   * The environments that have sent data in the last `days` days. Langfuse has no endpoint that
   * lists environments, so this groups the Metrics API v2 observation count by environment.
   */
  async listEnvironments(now: Date, days = ENVIRONMENT_LOOKBACK_DAYS): Promise<string[]> {
    const query = {
      view: 'observations',
      dimensions: [{ field: 'environment' }],
      metrics: [{ measure: 'count', aggregation: 'count' }],
      fromTimestamp: new Date(now.getTime() - days * MS_PER_DAY).toISOString(),
      toTimestamp: now.toISOString(),
      config: { row_limit: MAX_ENVIRONMENTS },
    };
    const page = await this.getJson<{ data: Array<{ environment?: unknown }> }>(
      '/api/public/v2/metrics',
      { query: JSON.stringify(query) },
    );
    const names = page.data.flatMap((row) =>
      typeof row.environment === 'string' && row.environment !== '' ? [row.environment] : [],
    );
    return [...new Set(names)].sort();
  }

  async listScores({
    names,
    from,
    to,
    fields = 'details,subject',
    traceId,
    observationId,
    onPage,
  }: ListScoresRequest): Promise<LangfuseScore[]> {
    const scores: LangfuseScore[] = [];
    let cursor: string | undefined;
    do {
      const query: Record<string, string> = {
        name: names.join(','),
        fields,
        fromTimestamp: from,
        toTimestamp: to,
        limit: String(SCORE_PAGE_SIZE),
      };
      if (traceId) query.traceId = traceId;
      if (traceId && observationId) query.observationId = observationId;
      if (cursor) query.cursor = cursor;
      const page = await this.getJson<ScorePage>('/api/public/v3/scores', query);
      scores.push(...page.data);
      onPage?.(scores.length);
      cursor = page.meta?.cursor ?? page.cursor;
    } while (cursor);
    return scores;
  }

  /**
   * Reads only the turn observations of one conversation or trace from
   * GET /api/public/v2/observations, which has no sunset date. Filtering by name keeps the
   * guardrail, judge and model-call rows, which are most of a trace, off the wire.
   */
  async getTurns(scope: TurnScope, id: string): Promise<LangfuseTurn[]> {
    const turns: LangfuseTurn[] = [];
    let cursor: string | undefined;
    do {
      const query: Record<string, string> = {
        [scope === 'trace' ? 'traceId' : 'sessionId']: id,
        name: this.options.turnName,
        fields: 'core,basic,io',
        limit: String(TURN_PAGE_SIZE),
      };
      if (cursor) query.cursor = cursor;
      const page = await this.getJson<TurnPage>('/api/public/v2/observations', query);
      turns.push(...page.data);
      cursor = page.meta?.cursor;
    } while (cursor);
    return turns;
  }

  /** Looks up many conversations or traces with bounded concurrency; a failure is reported, not fatal. */
  async getTurnGroups({
    scope,
    ids,
    onError,
    onProgress,
    maxTurns = Number.POSITIVE_INFINITY,
  }: GetTurnGroupsRequest): Promise<Map<string, LangfuseTurn[]>> {
    const groups = new Map<string, LangfuseTurn[]>();
    const queue = [...ids];
    let done = 0;
    let turnsRead = 0;
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const turns = await this.getTurns(scope, id);
          turnsRead += turns.length;
          groups.set(id, turns);
        } catch (err) {
          onError(id, err);
        }
        onProgress?.(++done, ids.length);
        if (turnsRead > maxTurns) {
          queue.length = 0;
          throw new TurnBudgetError(turnsRead, maxTurns);
        }
      }
    };
    await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
    return groups;
  }
}
