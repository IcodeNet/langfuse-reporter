import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureOutDir } from '../../output/check-out-dir.js';
import { writePrivateText } from '../../output/private-file.js';
import type { ExportRow } from './build-rows.js';
import { formatRows, type OutputFormat } from './format-rows.js';
import { assertSafeStem, type ExportPaths } from './export-paths.js';

export interface SplitDataFilesRequest {
  outDir: string;
  stem: string;
  rows: readonly ExportRow[];
  format: OutputFormat;
}

/** Writes feedback-positive-<stem>.<format> and feedback-negative-<stem>.<format>, skipping a side that has no rows. */
export async function writeSplitDataFiles({
  outDir,
  stem,
  rows,
  format,
}: SplitDataFilesRequest): Promise<ExportPaths> {
  assertSafeStem(stem);
  await ensureOutDir(outDir);
  const written: ExportPaths = { replaced: false };
  for (const side of ['positive', 'negative'] as const) {
    const path = join(outDir, `feedback-${side}-${stem}.${format}`);
    const sideRows = rows.filter((row) => row.rating === side);
    const existed = existsSync(path);
    written.replaced ||= existed;
    if (sideRows.length === 0) {
      if (existed) await rm(path);
      continue;
    }
    await writePrivateText(formatRows(sideRows, format), path);
    written[side] = path;
  }
  return written;
}
