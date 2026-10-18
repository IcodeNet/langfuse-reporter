import { parseCalendarDate } from '../config/calendar-date.js';

/** The report formats the page offers. Excel is the CLI's default and has no --format value. */
export const REPORT_FORMATS = ['excel', 'csv', 'json'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportRequest {
  from: string;
  to: string;
  /** The same filter language as `--where`; empty means every rating. */
  where?: string;
  format?: ReportFormat;
  /** True counts the ratings and writes nothing. */
  dryRun?: boolean;
  /** True after the user confirmed a large run. */
  yes?: boolean;
}

const MAX_FILTER_LENGTH = 500;

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkDate(label: string, value: unknown): Checked<string> {
  if (typeof value !== 'string' || Number.isNaN(parseCalendarDate(value))) {
    return { ok: false, message: `${label} must be a real date such as 2026-09-01` };
  }
  return { ok: true, value };
}

/**
 * Checks what the page sends before any of it reaches the CLI. Dates must be real, the format must
 * be one of three words, and the filter is plain text on one line. Nothing here starts with a dash,
 * so a value can never be read as a command option.
 */
export function checkReportRequest(body: unknown): Checked<ReportRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'The request must be an object' };
  const from = checkDate('The start date', body.from);
  if (!from.ok) return from;
  const to = checkDate('The end date', body.to);
  if (!to.ok) return to;
  if (parseCalendarDate(from.value) >= parseCalendarDate(to.value)) {
    return { ok: false, message: 'The start date must be before the end date' };
  }
  const where = body.where;
  if (where !== undefined && typeof where !== 'string') {
    return { ok: false, message: 'The filter must be text' };
  }
  const filter = (where ?? '').trim();
  if (
    filter.length > MAX_FILTER_LENGTH ||
    /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(filter)
  ) {
    return {
      ok: false,
      message: 'The filter must be plain text on one line, up to 500 characters',
    };
  }
  const format = body.format ?? 'excel';
  if (typeof format !== 'string' || !(REPORT_FORMATS as readonly string[]).includes(format)) {
    return { ok: false, message: 'The format must be excel, csv or json' };
  }
  return {
    ok: true,
    value: {
      from: from.value,
      to: to.value,
      ...(filter === '' ? {} : { where: filter }),
      format: format as ReportFormat,
      dryRun: body.dryRun === true,
      yes: body.yes === true,
    },
  };
}

/** The CLI arguments for a report request. The filter is one argument, so a shell never sees it. */
export function exportArgs(request: ReportRequest): string[] {
  return [
    'feedback',
    'export',
    '--from',
    request.from,
    '--to',
    request.to,
    ...(request.where ? ['--where', request.where] : []),
    ...(request.format && request.format !== 'excel' ? ['--format', request.format] : []),
    ...(request.dryRun ? ['--dry-run'] : []),
    ...(request.yes ? ['--yes'] : []),
  ];
}

/** The CLI arguments for `analyse`. Masking is never turned off here: there is no --no-mask. */
export function analyseArgs(request: ReportRequest): string[] {
  return [
    'analyse',
    '--from',
    request.from,
    '--to',
    request.to,
    ...(request.where ? ['--where', request.where] : []),
    ...(request.yes ? ['--yes'] : []),
  ];
}

/** The CLI arguments that print the matching rows as JSON for the table. Masked, as the CLI does by default. */
export function rowsArgs(request: ReportRequest): string[] {
  return [
    'feedback',
    'report',
    '--format',
    'json',
    '--from',
    request.from,
    '--to',
    request.to,
    ...(request.where ? ['--where', request.where] : []),
    ...(request.yes ? ['--yes'] : []),
  ];
}
