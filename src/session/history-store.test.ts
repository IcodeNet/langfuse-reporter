import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  historyPathFor,
  isWorthSaving,
  loadHistory,
  MAX_HISTORY_LINES,
  saveHistoryLine,
} from './history-store.js';

function makeFolder(): string {
  return mkdtempSync(join(tmpdir(), 'history-'));
}

describe('historyPathFor', () => {
  it('should put the history next to the config file when given its path', () => {
    expect(historyPathFor('/home/a/.config/langfuse-reporter/config.json')).toBe(
      '/home/a/.config/langfuse-reporter/history',
    );
  });
});

describe('isWorthSaving', () => {
  it.each([
    ['window 7d', true],
    ['where rating = negative', true],
    ['', false],
    ['   ', false],
    ['docs why does it need chat-turn', false],
    ['  DOCS what is a profile', false],
    ['docs', false],
    ['doctor', true],
  ])('should judge the line %j as %s when it is checked for saving', (line, expected) => {
    expect(isWorthSaving(line)).toBe(expected);
  });
});

describe('saveHistoryLine and loadHistory', () => {
  it('should give back the lines in the order they were typed when the file is read', () => {
    const path = join(makeFolder(), 'history');

    saveHistoryLine(path, 'window 7d');
    saveHistoryLine(path, 'where rating = negative');

    expect(loadHistory(path)).toEqual(['window 7d', 'where rating = negative']);
  });

  it('should not save the same line twice when it is typed twice in a row', () => {
    const path = join(makeFolder(), 'history');

    saveHistoryLine(path, 'doctor');
    saveHistoryLine(path, 'doctor');

    expect(loadHistory(path)).toEqual(['doctor']);
  });

  it('should save a line again when something else was typed between', () => {
    const path = join(makeFolder(), 'history');

    saveHistoryLine(path, 'doctor');
    saveHistoryLine(path, 'fields');
    saveHistoryLine(path, 'doctor');

    expect(loadHistory(path)).toEqual(['doctor', 'fields', 'doctor']);
  });

  it('should keep docs questions off the disk when they are typed', () => {
    const path = join(makeFolder(), 'history');

    saveHistoryLine(path, 'docs how do I find user 4471 complaints');
    saveHistoryLine(path, 'fields');

    expect(readFileSync(path, 'utf8')).toBe('fields\n');
  });

  it('should make the file readable by its owner only when it is created', () => {
    const path = join(makeFolder(), 'history');

    saveHistoryLine(path, 'fields');

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('should create the folder when it does not exist yet', () => {
    const path = join(makeFolder(), 'new', 'deeper', 'history');

    saveHistoryLine(path, 'fields');

    expect(loadHistory(path)).toEqual(['fields']);
  });

  it('should join the parts into one line when a line has a line break', () => {
    const path = join(makeFolder(), 'history');

    saveHistoryLine(path, 'where a\nrm -rf x');

    expect(loadHistory(path)).toEqual(['where a rm -rf x']);
  });

  it('should keep only the newest lines when the file has grown past the limit', () => {
    const path = join(makeFolder(), 'history');
    writeFileSync(
      path,
      `${Array.from({ length: MAX_HISTORY_LINES * 2 }, (_, index) => `cmd ${index}`).join('\n')}\n`,
    );

    saveHistoryLine(path, 'newest');

    expect([loadHistory(path).length, loadHistory(path).at(-1)]).toEqual([
      MAX_HISTORY_LINES,
      'newest',
    ]);
  });

  it('should give an empty list when the file does not exist', () => {
    expect(loadHistory('/nonexistent/folder/history')).toEqual([]);
  });

  it('should not raise when the history folder is really a file', () => {
    const blocker = join(makeFolder(), 'blocker');
    writeFileSync(blocker, 'x');

    expect(() => saveHistoryLine(join(blocker, 'history'), 'fields')).not.toThrow();
  });
});
