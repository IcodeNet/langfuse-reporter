import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { autoFit } from './auto-fit.js';

function sheetWith(rows: string[][]): ExcelJS.Worksheet {
  const sheet = new ExcelJS.Workbook().addWorksheet('s');
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

describe('autoFit', () => {
  it('should widen a column to its longest value plus padding when the value is short enough', () => {
    const sheet = sheetWith([['Date'], ['2026-10-14 10:11:31']]);

    autoFit(sheet, { maxWidth: 80 });

    expect(sheet.getColumn(1).width).toBe(21);
  });

  it('should stop at the maximum width and grow the row when the text is longer', () => {
    const sheet = sheetWith([['h'], ['x'.repeat(200)]]);

    autoFit(sheet, { maxWidth: 50 });

    expect([sheet.getColumn(1).width, sheet.getRow(2).height]).toEqual([50, 60]);
  });

  it('should give a row one line per line break when the cell holds several lines', () => {
    const sheet = sheetWith([['h'], ['a\nb\nc']]);

    autoFit(sheet, { maxWidth: 50 });

    expect(sheet.getRow(2).height).toBe(45);
  });

  it('should never ask for a row taller than Excel allows when the text is huge', () => {
    const sheet = sheetWith([['h'], ['x'.repeat(100_000)]]);

    autoFit(sheet, { maxWidth: 50 });

    expect(sheet.getRow(2).height).toBe(409);
  });

  it('should keep a minimum width when the column is nearly empty', () => {
    const sheet = sheetWith([['a']]);

    autoFit(sheet, { maxWidth: 50 });

    expect(sheet.getColumn(1).width).toBe(8);
  });
});
