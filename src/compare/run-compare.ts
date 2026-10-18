import { basename, extname, join } from 'node:path';
import { checkOutDir, ensureOutDir } from '../output/check-out-dir.js';
import type { Reporter } from '../ui/reporter.js';
import { compareRows, countVerdicts, VERDICT_ORDER } from './compare-rows.js';
import { resolveReportPath } from './list-reports.js';
import { readReportFile } from './read-report.js';
import { writeComparison } from './write-comparison.js';

export interface CompareRequest {
  beforePath: string;
  afterPath: string;
  outDir: string;
  reporter: Reporter;
}

/** A name that says what was compared and cannot escape the folder: only the two file stems are used. */
export function comparisonFileName(beforePath: string, afterPath: string): string {
  const stem = (path: string): string =>
    basename(path, extname(path))
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .slice(0, 60);
  return `compare-${stem(beforePath)}--vs--${stem(afterPath)}.xlsx`;
}

/**
 * Compares two reports and writes the three-sheet workbook. Returns the path, or undefined when a
 * file could not be used (the reason is already reported).
 */
export async function runCompare(request: CompareRequest): Promise<string | undefined> {
  const { outDir, reporter } = request;
  const beforePath = resolveReportPath(request.beforePath, outDir);
  const afterPath = resolveReportPath(request.afterPath, outDir);
  const problem = await checkOutDir(outDir);
  if (problem) {
    reporter.warn(problem);
    return undefined;
  }
  const readTask = reporter.task('Reading the two reports', 'fetch');
  let before;
  let after;
  try {
    before = await readReportFile(beforePath);
    after = await readReportFile(afterPath);
  } catch (err) {
    readTask.fail(err instanceof Error ? err.message : String(err));
    return undefined;
  }
  readTask.succeed(
    `Read ${before.rows.length} ratings from ${before.name} and ${after.rows.length} from ${after.name}`,
  );
  if (before.rows.length === 0 && after.rows.length === 0) {
    reporter.warn('Both reports have no ratings, so there is nothing to compare.');
    return undefined;
  }
  const rows = compareRows(before.rows, after.rows);
  const counts = countVerdicts(rows);
  const writeTask = reporter.task('Writing the comparison', 'write');
  await ensureOutDir(outDir);
  const path = join(outDir, comparisonFileName(beforePath, afterPath));
  await writeComparison({ path, before, after, rows });
  writeTask.succeed('Wrote the comparison workbook (sheets: 1 Before, 2 After, 3 Comparison)');
  for (const verdict of VERDICT_ORDER) {
    const count = counts.get(verdict);
    if (count) reporter.info(`${String(count).padStart(4)}  ${verdict}`);
  }
  reporter.block({ title: 'File written', emoji: '📁', rows: [['comparison', path]] });
  return path;
}
