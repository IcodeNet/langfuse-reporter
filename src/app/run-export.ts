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
import type { OutputFormat } from '../presets/chat-feedback/format-rows.js';
import { writeSplitWorkbooks, type ExportPaths } from '../presets/chat-feedback/write-workbooks.js';
import type { Reporter } from '../ui/reporter.js';
import type { Dataset } from './load-dataset.js';

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
  format?: OutputFormat;
  /** On unless false: user ids become codes and personal details leave the text. */
  mask?: boolean;
}

/** Filters, then writes the positive and negative files, reporting each step. Returns the paths written. */
export async function runExport({
  dataset,
  resolved,
  reporter,
  where,
  name,
  dryRun,
  format,
  mask = true,
}: ExportRequest): Promise<ExportPaths | undefined> {
  const filterTask = reporter.task(
    where ? `Applying filter: ${where}` : 'Selecting all ratings',
    'filter',
  );
  const expr = compileWhere(where, dataset);
  const matching = dataset.rows.filter((row) => matches(expr, row));
  const selected = mask ? maskRows(matching, createMasker()) : matching;
  const positive = selected.filter((row) => row.rating === 'positive').length;
  filterTask.succeed(
    `${selected.length} of ${dataset.rows.length} ratings selected (${positive} positive, ${selected.length - positive} negative)${mask ? '' : '; NOT masked'}`,
  );
  if (dryRun) {
    reporter.info('Dry run: no files written');
    return undefined;
  }
  const fileKind = format === undefined ? 'Excel' : format.toUpperCase();
  const writeTask = reporter.task(`Writing ${fileKind} files to ${resolved.outDir}`, 'write');
  const stem = exportStem({
    from: resolved.from,
    to: resolved.to,
    query: where,
    customName: name,
  });
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
  return paths;
}
