import { describe, expect, it } from 'vitest';
import {
  analyseArgs,
  checkReportRequest,
  exportArgs,
  rowsArgs,
  type ReportRequest,
} from './report-args.js';

const GOOD = { from: '2026-09-01', to: '2026-10-01' };

function accepted(body: unknown): ReportRequest {
  const checked = checkReportRequest(body);
  if (!checked.ok) throw new Error(checked.message);
  return checked.value;
}

function refusal(body: unknown): string {
  const checked = checkReportRequest(body);
  return checked.ok ? '' : checked.message;
}

describe('checkReportRequest', () => {
  it('should accept two real dates and default to Excel when nothing else is given', () => {
    expect(accepted(GOOD)).toEqual({ ...GOOD, format: 'excel', dryRun: false, yes: false });
  });

  it('should keep a plain filter when it is one line of text', () => {
    expect(accepted({ ...GOOD, where: ' rating = negative ' }).where).toBe('rating = negative');
  });

  it('should refuse a date that does not exist when the window is checked', () => {
    expect(refusal({ from: '2026-02-30', to: '2026-10-01' })).toContain('start date');
  });

  it('should refuse a missing end date when the window is checked', () => {
    expect(refusal({ from: '2026-09-01' })).toContain('end date');
  });

  it('should refuse a window that ends before it starts', () => {
    expect(refusal({ from: '2026-10-01', to: '2026-09-01' })).toContain('before');
  });

  it('should refuse a format that is not excel, csv or json', () => {
    expect(refusal({ ...GOOD, format: 'xml' })).toContain('excel, csv or json');
  });

  it('should refuse a filter with a line break when the filter is checked', () => {
    expect(refusal({ ...GOOD, where: 'rating = negative\nrm -rf' })).toContain('one line');
  });

  it('should refuse a filter that is too long', () => {
    expect(refusal({ ...GOOD, where: 'x'.repeat(501) })).toContain('500');
  });

  it('should refuse a body that is not an object', () => {
    expect(refusal('2026-09-01')).toContain('object');
  });

  it('should refuse a filter that is not text', () => {
    expect(refusal({ ...GOOD, where: ['a'] })).toContain('text');
  });
});

describe('exportArgs', () => {
  it('should pass the filter as one argument when it holds spaces and quotes', () => {
    const args = exportArgs(accepted({ ...GOOD, where: "comment ~ 'late; payment'" }));

    expect(args).toEqual([
      'feedback',
      'export',
      '--from',
      '2026-09-01',
      '--to',
      '2026-10-01',
      '--where',
      "comment ~ 'late; payment'",
    ]);
  });

  it('should add the format flag only when the format is not Excel', () => {
    expect([
      exportArgs(accepted(GOOD)).includes('--format'),
      exportArgs(accepted({ ...GOOD, format: 'csv' }))
        .join(' ')
        .includes('--format csv'),
    ]).toEqual([false, true]);
  });

  it('should add the dry-run and yes flags only when the page asked for them', () => {
    const args = exportArgs(accepted({ ...GOOD, dryRun: true, yes: true }));

    expect([args.includes('--dry-run'), args.includes('--yes')]).toEqual([true, true]);
  });

  it('should never pass a flag to turn masking off', () => {
    const all = [
      exportArgs(accepted({ ...GOOD, yes: true })),
      rowsArgs(accepted(GOOD)),
      analyseArgs(accepted(GOOD)),
    ].flat();

    expect(all.some((arg) => arg.includes('mask'))).toBe(false);
  });
});

describe('rowsArgs and analyseArgs', () => {
  it('should ask the report command for JSON when rows are wanted for the table', () => {
    expect(rowsArgs(accepted(GOOD)).slice(0, 4)).toEqual([
      'feedback',
      'report',
      '--format',
      'json',
    ]);
  });

  it('should name the analyse command and the window when the model is asked', () => {
    expect(analyseArgs(accepted(GOOD))).toEqual([
      'analyse',
      '--from',
      '2026-09-01',
      '--to',
      '2026-10-01',
    ]);
  });
});
