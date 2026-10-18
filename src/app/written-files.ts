import type { ExportPaths } from '../presets/chat-feedback/write-workbooks.js';

/** The rows of the "Files written" box: only the files that exist, and a note for the side left out. */
export function writtenFileRows(paths: ExportPaths): Array<[string, string]> {
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
