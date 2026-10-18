import type { Masker } from '../../output/mask.js';
import type { ExportRow } from './build-rows.js';

/** A copy of the rows with the user id replaced by a code and personal details removed from every free-text field. */
export function maskRows(rows: readonly ExportRow[], masker: Masker): ExportRow[] {
  return rows.map((row) => ({
    ...row,
    userId: masker.userId(row.userId),
    comment: masker.text(row.comment),
    ratedUser: masker.text(row.ratedUser),
    ratedAssistant: masker.text(row.ratedAssistant),
    conversation: masker.text(row.conversation),
  }));
}
