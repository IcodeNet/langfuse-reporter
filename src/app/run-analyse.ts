import { resolve } from 'node:path';
import { isProduction, PRODUCTION_ANALYSE_WARNING } from './production.js';
import { runInfoFor } from './run-info-for.js';
import { analyseFeedback } from '../presets/chat-feedback/analyse-feedback.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { matches } from '../dsl/evaluate.js';
import { createMasker } from '../output/mask.js';
import { maskRows } from '../presets/chat-feedback/mask-rows.js';
import { exportStem } from '../output/export-name.js';
import { asArgument } from '../output/run-info.js';
import { writeThemesWorkbook } from '../presets/chat-feedback/write-themes.js';
import { createLlmClient, LlmSetupError } from '../llm/llm-client.js';
import { isDemoBaseUrl } from '../demo/demo-constants.js';
import { createDemoLlmClient } from '../demo/demo-llm.js';
import type { Reporter } from '../ui/reporter.js';
import type { Dataset } from './load-dataset.js';
import { compileWhere } from './run-export.js';

/** Past this many ratings the text sent to the model gets expensive and slow; the user is asked to narrow first. */
export const MAX_ANALYSED_RATINGS = 600;

export interface AnalyseRequest {
  dataset: Dataset;
  resolved: ResolvedConfig;
  reporter: Reporter;
  where?: string;
  /** Allows more than {@link MAX_ANALYSED_RATINGS} ratings (`--yes`). */
  yes?: boolean;
  /** On unless false: nothing unmasked is sent to the model. */
  mask?: boolean;
}

/** What an analysis did, for a script: the themes with their counts, what was sent, and the file written. */
export interface AnalyseOutcome {
  /** Ratings sent to the model. */
  ratings: number;
  themes: Array<{ name: string; description: string; count: number }>;
  /** Ratings the model did not place; they are listed as Unclassified. */
  unplaced: number;
  /** Which model answered, as shown to the user. */
  model: string;
  /** True when user ids and personal details were removed before sending. */
  masked: boolean;
  file: string;
}

/** Sends the filtered ratings to the configured model, shows the common problems, and writes them to Excel. */
export async function runAnalyse(request: AnalyseRequest): Promise<AnalyseOutcome | undefined> {
  const { dataset, resolved, reporter, where, yes, mask = true } = request;
  let client;
  try {
    client = isDemoBaseUrl(resolved.profile.baseUrl)
      ? createDemoLlmClient()
      : createLlmClient({ settings: resolved.llm, apiKey: resolved.llmApiKey });
  } catch (err) {
    if (!(err instanceof LlmSetupError)) throw err;
    reporter.warn(err.message);
    return undefined;
  }
  const expr = compileWhere(where, dataset);
  const matching = dataset.rows.filter((row) => matches(expr, row));
  const rows = mask ? maskRows(matching, createMasker()) : matching;
  if (rows.length === 0) {
    reporter.warn('No ratings match, so there is nothing to analyse.');
    return undefined;
  }
  if (rows.length > MAX_ANALYSED_RATINGS && !yes) {
    reporter.warn(
      `${rows.length} ratings would be sent to ${client.describe()}. Narrow them with a filter (analyse where rating = negative), or add --yes to send all of them.`,
    );
    return undefined;
  }
  if (isProduction(resolved.profileName, dataset.project.name)) {
    reporter.warn(PRODUCTION_ANALYSE_WARNING);
  }
  reporter.info(
    `Sending ${rows.length} ${mask ? 'masked' : 'UNMASKED'} ratings (reasons, comments, questions, answers) to ${client.describe()}`,
  );
  const task = reporter.task(`Finding the common problems in ${rows.length} ratings`, 'docs');
  let analysis;
  try {
    analysis = await analyseFeedback({ rows, client, onProgress: (text) => task.update(text) });
  } catch (err) {
    task.fail(`The analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  task.succeed(`Found ${analysis.themes.length} themes in ${rows.length} ratings`);
  reporter.block({
    title: 'Common problems',
    emoji: '🧩',
    rows: analysis.themes.map((theme) => [
      `${theme.rows.length}  ${theme.name}`,
      theme.description,
    ]),
  });
  if (analysis.unplaced > 0) {
    reporter.warn(
      `${analysis.unplaced} ratings were not placed by the model; they are listed as Unclassified.`,
    );
  }
  const writeTask = reporter.task(`Writing the themes to ${resolved.outDir}`, 'write');
  const path = await writeThemesWorkbook({
    outDir: resolved.outDir,
    stem: exportStem({
      from: resolved.from,
      to: resolved.to,
      query: where,
    }),
    rows,
    analysis,
    source: {
      project: dataset.project,
      baseUrl: resolved.profile.baseUrl,
      labels: resolved.conventions,
      window: `${asArgument(resolved.from)} to ${asArgument(resolved.to)} (UTC, end not included)`,
      filter: where?.trim() ? where.trim() : 'none',
      run: runInfoFor(resolved, where),
    },
    model: client.describe(),
  });
  writeTask.succeed('Wrote the themes workbook');
  const file = resolve(path);
  reporter.block({ title: 'File written', emoji: '📁', rows: [['themes', file]] });
  return {
    ratings: rows.length,
    themes: analysis.themes.map((theme) => ({
      name: theme.name,
      description: theme.description,
      count: theme.rows.length,
    })),
    unplaced: analysis.unplaced,
    model: client.describe(),
    masked: mask,
    file,
  };
}
