import { resolve } from 'node:path';
import { runInfoFor } from './run-info-for.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { matches } from '../dsl/evaluate.js';
import { formatQueryError, parseQuery } from '../dsl/parse.js';
import { QueryError, type Expr } from '../dsl/types.js';
import { exportStem } from '../output/export-name.js';
import { asArgument } from '../output/run-info.js';
import { createMasker } from '../output/mask.js';
import { maskRows } from '../presets/chat-feedback/mask-rows.js';
import { writeSplitDataFiles } from '../presets/chat-feedback/write-data-files.js';
import { EVAL_REPORT_FORMAT, type ExportFormat } from '../presets/chat-feedback/format-rows.js';
import { writeEvalReportFile } from '../presets/chat-feedback/eval-report.js';
import { CLI_VERSION } from './cli-version.js';
import { writeSplitWorkbooks } from '../presets/chat-feedback/write-workbooks.js';
import type { Reporter } from '../ui/reporter.js';
import type { Dataset } from './load-dataset.js';
import type { ExportRow } from '../presets/chat-feedback/build-rows.js';

export function compileWhere(where: string | undefined, dataset: Dataset): Expr | undefined {
  if (!where) return undefined;
  try {
    return parseQuery(where, dataset.context);
  } catch (err) {
    if (err instanceof QueryError) {
      throw new Error(`Invalid filter\n${formatQueryError(where, err)}`, { cause: err });
    }
    throw err;
  }
}

export interface ExportRequest {
  dataset: Dataset;
  resolved: ResolvedConfig;
  reporter: Reporter;
  where?: string;
  /** A name the user chose for the files; replaces the query-derived part of the file name. */
  name?: string;
  dryRun?: boolean;
  /** Excel when absent. */
  format?: ExportFormat;
  /** On unless false: user ids become codes and personal details leave the text. */
  mask?: boolean;
}

/** What an export did, for a script: how many ratings were in the window, how many were chosen, and the files. */
export interface ExportOutcome {
  found: number;
  selected: number;
  positive: number;
  negative: number;
  dryRun: boolean;
  /** Present on a dry run: true when the counts came from the ratings alone, so a real export may hold fewer rows. */
  countedFromRatingsOnly?: boolean;
  files: Array<{ kind: 'positive' | 'negative' | 'eval-report'; path: string }>;
  replaced: boolean;
}

/** Filters, then writes the positive and negative files, reporting each step. Returns what was done. */
export async function runExport({
  dataset,
  resolved,
  reporter,
  where,
  name,
  dryRun,
  format,
  mask = true,
}: ExportRequest): Promise<ExportOutcome> {
  const filterTask = reporter.task(
    where ? `Applying filter: ${where}` : 'Selecting all ratings',
    'filter',
  );
  const expr = compileWhere(where, dataset);
  const matching = dataset.rows.filter((row) => matches(expr, row));
  const shouldMask = mask || format === EVAL_REPORT_FORMAT;
  const selected = shouldMask ? maskRows(matching, createMasker()) : matching;
  const positive = selected.filter((row) => row.rating === 'positive').length;
  filterTask.succeed(
    `${selected.length} of ${dataset.rows.length} ratings selected (${positive} positive, ${selected.length - positive} negative)${shouldMask ? '' : '; NOT masked'}`,
  );
  const counts = {
    found: dataset.rows.length,
    selected: selected.length,
    positive,
    negative: selected.length - positive,
  };
  if (dryRun) {
    reporter.info('Dry run: no files written');
    return {
      ...counts,
      dryRun: true,
      countedFromRatingsOnly: dataset.notes.countedFromRatingsOnly === true,
      files: [],
      replaced: false,
    };
  }
  const stem = exportStem({
    from: resolved.from,
    to: resolved.to,
    query: where,
    customName: name,
  });
  if (format === EVAL_REPORT_FORMAT) {
    return writeEvalReport({ resolved, reporter, dataset, where, stem, selected, counts });
  }
  const fileKind = format === undefined ? 'Excel' : format.toUpperCase();
  const writeTask = reporter.task(`Writing ${fileKind} files to ${resolved.outDir}`, 'write');
  const paths =
    format === undefined
      ? await writeSplitWorkbooks({
          outDir: resolved.outDir,
          stem,
          rows: selected,
          source: {
            project: dataset.project,
            baseUrl: resolved.profile.baseUrl,
            labels: resolved.conventions,
            window: `${asArgument(resolved.from)} to ${asArgument(resolved.to)} (UTC, end not included)`,
            filter: where?.trim() ? where.trim() : 'none',
            run: runInfoFor(resolved, where),
          },
        })
      : await writeSplitDataFiles({ outDir: resolved.outDir, stem, rows: selected, format });
  const fileCount = [paths.positive, paths.negative].filter(Boolean).length;
  const noun = fileCount === 1 ? `${fileKind} file` : `${fileKind} files`;
  writeTask.succeed(
    paths.replaced
      ? `Wrote ${fileCount} ${noun} (replaced the earlier export of this same query)`
      : `Wrote ${fileCount} ${noun}`,
  );
  const files: ExportOutcome['files'] = [];
  if (paths.positive) files.push({ kind: 'positive', path: resolve(paths.positive) });
  if (paths.negative) files.push({ kind: 'negative', path: resolve(paths.negative) });
  return { ...counts, dryRun: false, files, replaced: paths.replaced };
}

interface EvalReportWrite {
  resolved: ResolvedConfig;
  reporter: Reporter;
  dataset: Dataset;
  where: string | undefined;
  stem: string;
  selected: readonly ExportRow[];
  counts: Pick<ExportOutcome, 'found' | 'selected' | 'positive' | 'negative'>;
}

/** One eval-report/v1 file holding the selected thumbs-down; thumbs-up are not written. */
async function writeEvalReport({
  resolved,
  reporter,
  dataset,
  where,
  stem,
  selected,
  counts,
}: EvalReportWrite): Promise<ExportOutcome> {
  const writeTask = reporter.task(`Writing the eval report to ${resolved.outDir}`, 'write');
  const written = await writeEvalReportFile({
    outDir: resolved.outDir,
    stem,
    rows: selected,
    source: {
      cliVersion: CLI_VERSION,
      generatedAt: new Date(),
      from: resolved.from,
      to: resolved.to,
      where,
      projectName: dataset.project.name,
      riskAreas: resolved.conventions.riskAreas,
      ratingsInWindow: counts.found,
    },
  });
  writeTask.succeed(
    written.path
      ? `Wrote the eval report with ${counts.negative} thumbs-down${written.replaced ? ' (replaced the earlier export of this same query)' : ''}`
      : 'No thumbs-down selected, so no eval report was written',
  );
  const files: ExportOutcome['files'] = written.path
    ? [{ kind: 'eval-report', path: resolve(written.path) }]
    : [];
  return { ...counts, dryRun: false, files, replaced: written.replaced };
}
