import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** One Excel file in the reports folder, as the suggestion list shows it. */
export interface ReportFile {
  name: string;
  modified: Date;
  bytes: number;
}

/** Enough to fill the list; a folder with thousands of files is not read file by file. */
const MAX_FILES_LOOKED_AT = 300;
const MAX_FILES_LISTED = 12;

/** The comparison workbooks this command writes have no report sheet, so they are never offered. */
const COMPARISON_PREFIX = 'compare-';

function isOfferable(name: string): boolean {
  return (
    name.toLowerCase().endsWith('.xlsx') &&
    !name.startsWith(COMPARISON_PREFIX) &&
    !name.startsWith('~$') &&
    !/\s/.test(name)
  );
}

/**
 * The report files in a folder, newest first. A folder that is missing or unreadable gives an empty
 * list, because this runs on every keystroke and must never raise.
 */
export function listReportFiles(folder: string): ReportFile[] {
  let names: string[];
  try {
    names = readdirSync(folder).filter(isOfferable).slice(0, MAX_FILES_LOOKED_AT);
  } catch {
    return [];
  }
  const files: ReportFile[] = [];
  for (const name of names) {
    try {
      const stats = statSync(join(folder, name));
      if (stats.isFile()) files.push({ name, modified: stats.mtime, bytes: stats.size });
    } catch {
      continue;
    }
  }
  return files
    .sort((a, b) => b.modified.getTime() - a.modified.getTime() || a.name.localeCompare(b.name))
    .slice(0, MAX_FILES_LISTED);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "2026-10-14 15:20, 12 KB": when the file was written and how big it is. */
export function describeReportFile(file: ReportFile): string {
  const day = `${file.modified.getFullYear()}-${pad(file.modified.getMonth() + 1)}-${pad(file.modified.getDate())}`;
  const time = `${pad(file.modified.getHours())}:${pad(file.modified.getMinutes())}`;
  const kilobytes = Math.max(1, Math.round(file.bytes / 1024));
  return `${day} ${time}, ${kilobytes} KB`;
}

/**
 * A bare file name (no folder part) that is not in the current folder but is in the reports folder
 * means the report suggested by the list; anything else is used as typed.
 */
export function resolveReportPath(typed: string, reportsDir: string): string {
  const isBareName = !isAbsolute(typed) && !/[\\/]/.test(typed);
  if (!isBareName || existsSync(typed)) return typed;
  const inReports = join(reportsDir, typed);
  return existsSync(inReports) ? inReports : typed;
}
