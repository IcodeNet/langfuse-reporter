/** What every export writer shares: the paths it reports and the check that keeps a name inside the output folder. */

export interface ExportPaths {
  /** Absent when no positive rating was selected: an empty file would only look like a failed export. */
  positive?: string;
  /** Absent when no negative rating was selected. */
  negative?: string;
  /** True when an earlier export of the same name was overwritten. */
  replaced: boolean;
}

const SAFE_STEM = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;

/** Refuses a name that could point outside the export folder. */
export function assertSafeStem(stem: string): void {
  if (!SAFE_STEM.test(stem) || stem.includes('..')) {
    throw new Error(`Export name "${stem}" is not a safe file name`);
  }
}
