import type { ExportPaths } from '../presets/chat-feedback/export-paths.js';

/** The rows of the "Files written" box: only the files that exist, and a note for the side left out. */
export function writtenFileRows(
  paths: Pick<ExportPaths, 'positive' | 'negative'> & { evalReport?: string },
): Array<[string, string]> {
  if (paths.evalReport) return [['eval report', paths.evalReport]];
  const rows: Array<[string, string]> = [];
  if (paths.positive) rows.push(['positive', paths.positive]);
  if (paths.negative) rows.push(['negative', paths.negative]);
  if (!paths.positive && paths.negative)
    rows.push(['positive', 'not written: no positive ratings selected']);
  if (!paths.negative && paths.positive)
    rows.push(['negative', 'not written: no negative ratings selected']);
  if (rows.length === 0) rows.push(['files', 'none written: no ratings were selected']);
  return rows;
}

/** The positive and negative file paths of an export, for the screen listing. */
export function pathsOf(outcome: {
  files: Array<{ kind: 'positive' | 'negative' | 'eval-report'; path: string }>;
}): {
  positive?: string;
  negative?: string;
  evalReport?: string;
} {
  return {
    positive: outcome.files.find((file) => file.kind === 'positive')?.path,
    negative: outcome.files.find((file) => file.kind === 'negative')?.path,
    evalReport: outcome.files.find((file) => file.kind === 'eval-report')?.path,
  };
}
