import type ExcelJS from 'exceljs';

/** Excel refuses a row taller than this. */
const MAX_ROW_HEIGHT = 409;
const LINE_HEIGHT = 15;
const MIN_WIDTH = 8;
const WIDTH_PADDING = 2;

export interface AutoFitOptions {
  /** Widest a column may grow; longer text wraps instead of widening further. */
  maxWidth: number;
}

function linesIn(text: string): string[] {
  return text.split(/\r?\n/);
}

function longestLine(text: string): number {
  return Math.max(...linesIn(text).map((line) => line.length));
}

/** How many screen lines the text takes once it wraps at the column width. */
function wrappedLines(text: string, width: number): number {
  return linesIn(text).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
}

/**
 * Sizes every column to its content (up to maxWidth) and every row to the wrapped text it holds, so
 * nothing is cut off on opening. Hyperlink cells count by their visible text.
 */
export function autoFit(sheet: ExcelJS.Worksheet, { maxWidth }: AutoFitOptions): void {
  const widths = new Map<number, number>();
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const wanted = Math.min(maxWidth, longestLine(cell.text) + WIDTH_PADDING);
      widths.set(column, Math.max(widths.get(column) ?? MIN_WIDTH, wanted));
    });
  });
  for (const [column, width] of widths) sheet.getColumn(column).width = width;

  sheet.eachRow((row) => {
    let tallest = 1;
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      tallest = Math.max(tallest, wrappedLines(cell.text, widths.get(column) ?? MIN_WIDTH));
    });
    row.height = Math.min(MAX_ROW_HEIGHT, tallest * LINE_HEIGHT);
  });
}
