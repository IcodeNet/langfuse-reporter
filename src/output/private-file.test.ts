import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { replaceFile, writePrivateText, writePrivateWorkbook } from './private-file.js';

function workbookWith(text: string): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('S').addRow([text]);
  return workbook;
}

describe('writePrivateWorkbook', () => {
  it('should make the file readable by its owner only when it is written', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pf-')), 'a.xlsx');

    await writePrivateWorkbook(workbookWith('x'), path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('should keep the file owner-only when an earlier file with open permissions is replaced', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pf-')), 'a.xlsx');
    await writePrivateWorkbook(workbookWith('first'), path);

    await writePrivateWorkbook(workbookWith('second'), path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('should write a workbook that opens again with its content when it is read back', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pf-')), 'a.xlsx');
    await writePrivateWorkbook(workbookWith('hello'), path);

    const reread = new ExcelJS.Workbook();
    await reread.xlsx.readFile(path);

    expect(reread.worksheets[0]?.getRow(1).getCell(1).text).toBe('hello');
  });

  it('should leave no temporary file behind when the write succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));

    await writePrivateWorkbook(workbookWith('x'), join(dir, 'a.xlsx'));

    expect(readdirSync(dir)).toEqual(['a.xlsx']);
  });

  it('should leave no temporary file behind when the folder does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));

    await expect(
      writePrivateWorkbook(workbookWith('x'), join(dir, 'missing', 'a.xlsx')),
    ).rejects.toThrow('ENOENT');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('should leave only the finished files in the folder when several are written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));

    await writePrivateWorkbook(workbookWith('a'), join(dir, 'a.xlsx'));
    await writePrivateWorkbook(workbookWith('b'), join(dir, 'b.xlsx'));

    expect(readdirSync(dir).sort()).toEqual(['a.xlsx', 'b.xlsx']);
  });

  it('should never write through the link when a symbolic link sits where the final file goes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));
    const target = join(dir, 'victim.txt');
    writeFileSync(target, 'keep me');
    symlinkSync(target, join(dir, 'a.xlsx'));

    await writePrivateWorkbook(workbookWith('x'), join(dir, 'a.xlsx'));

    expect(readFileSync(target, 'utf8')).toBe('keep me');
  });

  it('should keep owner-only permissions even when the process umask would allow more', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));
    const before = process.umask(0o000);
    try {
      await writePrivateWorkbook(workbookWith('x'), join(dir, 'a.xlsx'));
    } finally {
      process.umask(before);
    }

    expect(statSync(join(dir, 'a.xlsx')).mode & 0o777).toBe(0o600);
  });
});

describe('replaceFile', () => {
  const refusal = (code: string): Error => Object.assign(new Error(code), { code });

  it('should remove the old file and move again when the system refuses with EEXIST', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));
    writeFileSync(join(dir, 'old.txt'), 'old');
    writeFileSync(join(dir, 'new.tmp'), 'new');
    let attempts = 0;
    const move = async (from: string, to: string): Promise<void> => {
      attempts += 1;
      if (attempts === 1) throw refusal('EEXIST');
      renameSync(from, to);
    };

    await replaceFile(join(dir, 'new.tmp'), join(dir, 'old.txt'), move);

    expect([attempts, readFileSync(join(dir, 'old.txt'), 'utf8')]).toEqual([2, 'new']);
  });

  it('should do the same when the system refuses with EPERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));
    writeFileSync(join(dir, 'old.txt'), 'old');
    writeFileSync(join(dir, 'new.tmp'), 'new');
    let attempts = 0;
    const move = async (from: string, to: string): Promise<void> => {
      attempts += 1;
      if (attempts === 1) throw refusal('EPERM');
      renameSync(from, to);
    };

    await replaceFile(join(dir, 'new.tmp'), join(dir, 'old.txt'), move);

    expect(readFileSync(join(dir, 'old.txt'), 'utf8')).toBe('new');
  });

  it('should raise the error and keep the old file when the refusal is any other kind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));
    writeFileSync(join(dir, 'old.txt'), 'old');
    const move = async (): Promise<void> => {
      throw refusal('ENOSPC');
    };

    await expect(replaceFile(join(dir, 'new.tmp'), join(dir, 'old.txt'), move)).rejects.toThrow(
      'ENOSPC',
    );
    expect(readFileSync(join(dir, 'old.txt'), 'utf8')).toBe('old');
  });
});

describe('writePrivateText', () => {
  it('should write the text with owner-only permissions when the file is created', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pt-')), 'a.csv');

    await writePrivateText('a,b\n', path);

    expect([readFileSync(path, 'utf8'), statSync(path).mode & 0o777]).toEqual(['a,b\n', 0o600]);
  });
});
