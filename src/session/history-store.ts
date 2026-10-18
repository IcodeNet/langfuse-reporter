import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Lines kept on disk; older ones are dropped when the file grows past twice this. */
export const MAX_HISTORY_LINES = 500;

/** `docs <question>` can carry customer wording, so questions are never written to disk. */
const NEVER_SAVED = /^\s*docs(\s|$)/i;

/** Where the typed commands are kept: next to the config file, readable by the owner only. */
export function historyPathFor(configPath: string): string {
  return join(dirname(configPath), 'history');
}

/** True for a line worth keeping: not empty, not a docs question. */
export function isWorthSaving(line: string): boolean {
  return line.trim() !== '' && !NEVER_SAVED.test(line);
}

/**
 * The saved commands, oldest first. A missing or unreadable file gives an empty list, because a
 * history problem must never stop the session from opening.
 */
export function loadHistory(path: string): string[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-MAX_HISTORY_LINES);
  } catch {
    return [];
  }
}

/** Adds one line to the file; the last line repeated is not saved twice. Failures are ignored. */
export function saveHistoryLine(path: string, line: string): void {
  const clean = line.replace(/[\r\n]+/g, ' ').trim();
  if (!isWorthSaving(clean)) return;
  try {
    const saved = loadHistory(path);
    if (saved.at(-1) === clean) return;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${clean}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    if (saved.length + 1 > MAX_HISTORY_LINES * 2) {
      writeFileSync(path, `${[...saved, clean].slice(-MAX_HISTORY_LINES).join('\n')}\n`, {
        mode: 0o600,
      });
    }
  } catch {
    return;
  }
}
