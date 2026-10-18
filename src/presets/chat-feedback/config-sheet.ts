import { brand } from '../../brand/brand.js';
import type ExcelJS from 'exceljs';
import { autoFit } from '../../output/auto-fit.js';
import { reproduceCommand, type RunInfo } from '../../output/run-info.js';

const HEADER_FILL = 'FF1F3864';

function line(label: string, value: string): [string, string] {
  return [label, value];
}

function describeRows(run: RunInfo, rowCount: number): Array<[string, string]> {
  const { conventions } = run;
  return [
    line('Generated (UTC)', run.generatedAt.toISOString().slice(0, 19).replace('T', ' ')),
    line(`${brand.name} CLI version`, run.cliVersion),
    line('Profile', run.profileName),
    line(
      'Env file (name only)',
      run.envFileName ?? 'none: the keys came from the environment of the shell',
    ),
    line('Langfuse address', run.baseUrl),
    line('Date window from (UTC)', run.from),
    line('Date window to (UTC, not included)', run.to),
    line('Filter', run.where ?? 'none, every rating in the window'),
    line('Rows in this file', String(rowCount)),
    line('Turn name', conventions.turnName),
    line('Rating score', conventions.ratingScore),
    line('Reason score prefix', conventions.reasonScorePrefix),
    line('Reasons', conventions.reasons.join(', ')),
    line('Values that mean thumbs up', conventions.yesValues.join(', ')),
    line('Assistant name', conventions.assistantName),
    line('Pass / Fail labels', `${conventions.passLabel} / ${conventions.failLabel}`),
    line('To make this report again', reproduceCommand(run)),
    line(
      'About the keys',
      'The Langfuse keys are never written into this file. They come from the env file named above.',
    ),
  ];
}

/**
 * Adds the sheet that says how the file was made, so anyone can read it and run the same report.
 * It is the same in every workbook the CLI writes, which is also how two files are compared.
 */
export function addConfigSheet(workbook: ExcelJS.Workbook, run: RunInfo, rowCount: number): void {
  const sheet = workbook.addWorksheet('Config and filters');
  sheet.addRow(['Setting', 'Value']);
  for (const row of describeRows(run, rowCount)) sheet.addRow(row);
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  });
  sheet.eachRow((excelRow, index) => {
    if (index === 1) return;
    excelRow.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
    excelRow.getCell(1).font = { bold: true };
  });
  autoFit(sheet, { maxWidth: 110 });
}
