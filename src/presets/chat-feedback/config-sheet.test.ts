import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeMockRunInfo } from '../../output/__mocks__/makeMockRunInfo.mock.js';
import { addConfigSheet } from './config-sheet.js';

async function sheetAsPairs(
  run = makeMockRunInfo(),
  rowCount = 2,
): Promise<Record<string, string>> {
  const workbook = new ExcelJS.Workbook();
  addConfigSheet(workbook, run, rowCount);
  const path = join(mkdtempSync(join(tmpdir(), 'cs-')), 'x.xlsx');
  await workbook.xlsx.writeFile(path);
  const read = new ExcelJS.Workbook();
  await read.xlsx.readFile(path);
  const sheet = read.getWorksheet('Config and filters')!;
  const pairs: Record<string, string> = {};
  sheet.eachRow((row, index) => {
    if (index > 1) pairs[row.getCell(1).text] = row.getCell(2).text;
  });
  return pairs;
}

describe('addConfigSheet', () => {
  it('should state the profile, the env file name and the window when the report is made', async () => {
    const pairs = await sheetAsPairs();

    expect([
      pairs['Profile'],
      pairs['Env file (name only)'],
      pairs['Date window from (UTC)'],
    ]).toEqual(['dev', 'dev.env', '2026-10-13T00:00:00.000Z']);
  });

  it('should hold the command that makes the same report again when the sheet is written', async () => {
    const pairs = await sheetAsPairs();

    expect(pairs['To make this report again']).toBe(
      "jeves --profile 'dev' feedback export --from 2026-10-13 --to 2026-10-15",
    );
  });

  it('should say none when there was no filter and show the filter when there was one', async () => {
    const none = await sheetAsPairs();
    const some = await sheetAsPairs(makeMockRunInfo({ where: 'rating = negative' }));

    expect([none['Filter'], some['Filter']]).toEqual([
      'none, every rating in the window',
      'rating = negative',
    ]);
  });

  it('should record the row count and the conventions when the sheet is written', async () => {
    const pairs = await sheetAsPairs(makeMockRunInfo(), 7);

    expect([pairs['Rows in this file'], pairs['Turn name'], pairs['Rating score']]).toEqual([
      '7',
      'chat-turn',
      'feedback_helpful',
    ]);
  });

  it('should never contain a key or a folder path when the sheet is written', async () => {
    const pairs = await sheetAsPairs(makeMockRunInfo({ envFileName: 'dev.env' }));
    const everything = Object.values(pairs).join('\n');

    expect(everything).not.toMatch(/pk-lf|sk-lf|\/home\//);
  });
});
