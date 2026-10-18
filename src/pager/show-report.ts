import { summariseWindow } from '../app/search-criteria.js';
import { compileWhere } from '../app/run-export.js';
import type { Dataset } from '../app/load-dataset.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { matches } from '../dsl/evaluate.js';
import type { Reporter } from '../ui/reporter.js';
import { buildReportLines, type ReportInfo } from './report-lines.js';
import { canPage, runPager } from './run-pager.js';

export interface ShowReportRequest {
  dataset: Dataset;
  resolved: ResolvedConfig;
  reporter: Reporter;
  where: string | undefined;
  color: boolean;
  /** Width for the plain-text fallback; the pager reads the live terminal width itself. */
  columns: number;
}

/**
 * Shows the matching ratings in the pager. Without a terminal (a pipe, CI) the same text is printed
 * once, so `jeves feedback report | less` and redirects work.
 */
export async function showReport(request: ShowReportRequest): Promise<number> {
  const { dataset, resolved, reporter, where } = request;
  const expr = compileWhere(where, dataset);
  const rows = dataset.rows.filter((row) => matches(expr, row));
  const info: ReportInfo = {
    projectName: dataset.project.name,
    profileName: resolved.profileName,
    window: summariseWindow(resolved),
    where: where?.trim() ? where.trim() : undefined,
    loadedCount: dataset.rows.length,
  };
  const build = (columns: number) => buildReportLines(rows, info, columns);
  if (!canPage()) {
    for (const line of build(request.columns)) reporter.note(line.text);
    return rows.length;
  }
  await runPager({ buildLines: build, color: request.color });
  return rows.length;
}
