import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeReportFile, listReportFiles, resolveReportPath } from './list-reports.js';

function makeFolder(files: ReadonlyArray<readonly [name: string, isoDate: string]>): string {
  const folder = mkdtempSync(join(tmpdir(), 'reports-'));
  for (const [name, isoDate] of files) {
    const path = join(folder, name);
    writeFileSync(path, 'x');
    const when = new Date(isoDate);
    utimesSync(path, when, when);
  }
  return folder;
}

describe('listReportFiles', () => {
  it('should list the newest report first when the folder has several', () => {
    const folder = makeFolder([
      ['old.xlsx', '2026-10-01T10:00:00Z'],
      ['new.xlsx', '2026-10-14T10:00:00Z'],
      ['mid.xlsx', '2026-10-07T10:00:00Z'],
    ]);

    expect(listReportFiles(folder).map((file) => file.name)).toEqual([
      'new.xlsx',
      'mid.xlsx',
      'old.xlsx',
    ]);
  });

  it('should leave out files that are not reports when the folder has other things in it', () => {
    const folder = makeFolder([
      ['report.xlsx', '2026-10-14T10:00:00Z'],
      ['notes.txt', '2026-10-14T10:00:00Z'],
      ['compare-a--vs--b.xlsx', '2026-10-14T10:00:00Z'],
      ['~$report.xlsx', '2026-10-14T10:00:00Z'],
      ['two words.xlsx', '2026-10-14T10:00:00Z'],
    ]);

    expect(listReportFiles(folder).map((file) => file.name)).toEqual(['report.xlsx']);
  });

  it('should leave out a folder whose name ends in .xlsx when listing files', () => {
    const folder = makeFolder([['real.xlsx', '2026-10-14T10:00:00Z']]);
    mkdirSync(join(folder, 'tricky.xlsx'));

    expect(listReportFiles(folder).map((file) => file.name)).toEqual(['real.xlsx']);
  });

  it('should give an empty list when the folder does not exist', () => {
    expect(listReportFiles('/nonexistent/reports')).toEqual([]);
  });

  it('should give at most twelve files when the folder is full', () => {
    const folder = makeFolder(
      Array.from({ length: 20 }, (_, index) => [
        `r${String(index).padStart(2, '0')}.xlsx`,
        `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
      ]),
    );

    expect(listReportFiles(folder)).toHaveLength(12);
  });
});

describe('describeReportFile', () => {
  it('should show when the file was written and how big it is', () => {
    const modified = new Date(2026, 9, 14, 15, 20);

    expect(describeReportFile({ name: 'a.xlsx', modified, bytes: 12_500 })).toBe(
      '2026-10-14 15:20, 12 KB',
    );
  });

  it('should show at least 1 KB when the file is tiny', () => {
    expect(
      describeReportFile({ name: 'a.xlsx', modified: new Date(2026, 0, 2, 3, 4), bytes: 10 }),
    ).toBe('2026-01-02 03:04, 1 KB');
  });
});

describe('resolveReportPath', () => {
  it('should find a bare name in the reports folder when it is not in the current folder', () => {
    const folder = makeFolder([['only-here-9f3a.xlsx', '2026-10-14T10:00:00Z']]);

    expect(resolveReportPath('only-here-9f3a.xlsx', folder)).toBe(
      join(folder, 'only-here-9f3a.xlsx'),
    );
  });

  it('should keep the path as typed when it has a folder part', () => {
    const folder = makeFolder([['a.xlsx', '2026-10-14T10:00:00Z']]);

    expect(resolveReportPath('sub/a.xlsx', folder)).toBe('sub/a.xlsx');
  });

  it('should keep the path as typed when it is absolute', () => {
    expect(resolveReportPath('/tmp/a.xlsx', '/somewhere')).toBe('/tmp/a.xlsx');
  });

  it('should keep the name as typed when the reports folder does not have it either', () => {
    const folder = makeFolder([['a.xlsx', '2026-10-14T10:00:00Z']]);

    expect(resolveReportPath('missing.xlsx', folder)).toBe('missing.xlsx');
  });
});
