import type { ConfigFile } from '../config/config-schema.js';
import { resolveConfig } from '../config/resolve-config.js';
import { presetWindow } from '../config/window-presets.js';
import { matches } from '../dsl/evaluate.js';
import { loadDataset } from '../app/load-dataset.js';
import { compileWhere } from '../app/run-export.js';
import type { Reporter } from '../ui/reporter.js';
import { checkRule, type RuleResult } from './query-rules.js';
import { unknownQueryMessage } from './saved-queries.js';

/** 0 every rule passed, 1 a rule failed, 2 the check could not be made. */
export type QueryExit = 0 | 1 | 2;

export interface QueryOutcome {
  name: string;
  exit: QueryExit;
  window?: { from: string; to: string };
  matched?: number;
  negative?: number;
  windowTotal?: number;
  rules: RuleResult[];
  /** Why the check could not be made; set only when exit is 2 because of an error. */
  error?: string;
}

export interface RunQueryRequest {
  name: string;
  config: ConfigFile;
  profileOverride: string | undefined;
  reporter: Reporter;
  yes?: boolean;
  now?: Date;
}

function exitFor(results: readonly RuleResult[]): QueryExit {
  if (results.some((result) => result.status === 'fail')) return 1;
  if (results.some((result) => result.status === 'unchecked')) return 2;
  return 0;
}

/** Runs one saved query. Never throws: every failure to check becomes exit 2, so a broken setup cannot pass or fail a build by accident. */
export async function runSavedQuery(request: RunQueryRequest): Promise<QueryOutcome> {
  const { name, config, profileOverride, reporter, yes, now = new Date() } = request;
  const query = Object.hasOwn(config.queries, name) ? config.queries[name] : undefined;
  if (!query) {
    return { name, exit: 2, rules: [], error: unknownQueryMessage(name, config) };
  }
  try {
    const window = query.window ? presetWindow(query.window, now) : undefined;
    const resolved = resolveConfig(config, { profile: profileOverride, ...window }, now);
    // No filter here: it could narrow the fetch, and the rate must divide by every rating in the window.
    const dataset = await loadDataset(resolved, reporter, { yes });
    const expr = compileWhere(query.where, dataset);
    const matching = dataset.rows.filter((row) => matches(expr, row));
    const counts = {
      total: matching.length,
      negative: matching.filter((row) => row.rating === 'negative').length,
      windowTotal: dataset.rows.length,
    };
    const rules = query.rules.map((rule) => checkRule(rule, counts));
    return {
      name,
      exit: exitFor(rules),
      window: { from: resolved.from, to: resolved.to },
      matched: counts.total,
      negative: counts.negative,
      windowTotal: counts.windowTotal,
      rules,
    };
  } catch (err) {
    return {
      name,
      exit: 2,
      rules: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The worst result wins: 1 over 2 over 0. */
export function overallExit(outcomes: readonly QueryOutcome[]): QueryExit {
  if (outcomes.some((outcome) => outcome.exit === 1)) return 1;
  if (outcomes.some((outcome) => outcome.exit === 2)) return 2;
  return 0;
}

function formatNumber(value: number | null): string {
  if (value === null) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/** One line per rule, then a summary line; plain text for a log. */
export function describeOutcome(outcome: QueryOutcome): string[] {
  const head = `${outcome.name}: ${['PASS', 'FAIL', 'COULD NOT CHECK'][outcome.exit]}`;
  if (outcome.error) return [head, `  ${outcome.error}`];
  const lines = outcome.rules.map(
    (result) =>
      `  ${{ pass: 'PASS', fail: 'FAIL', unchecked: 'UNCHECKED' }[result.status]}  ${result.rule}  (actual ${formatNumber(result.actual)})`,
  );
  const counted = `  ${outcome.matched} matched, ${outcome.negative} negative, ${outcome.windowTotal} ratings in the window`;
  return [head, ...lines, counted];
}
