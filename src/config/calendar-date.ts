const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** True when the year, month and day name a real calendar day, so 2026-02-30 is not silently moved to March. */
function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function hasRealDay(text: string): boolean {
  const found = DATE_ONLY.exec(text.slice(0, 10));
  const [, year = '', month = '', day = ''] = found ?? [];
  return found !== null && isRealCalendarDay(Number(year), Number(month), Number(day));
}

/** Accepts 2026-09-01 or an ISO timestamp with a zone; returns epoch milliseconds, or NaN for anything else. */
export function parseCalendarDate(text: string): number {
  if (DATE_ONLY.test(text)) return hasRealDay(text) ? Date.parse(`${text}T00:00:00Z`) : Number.NaN;
  if (!ISO_TIMESTAMP.test(text) || !hasRealDay(text)) return Number.NaN;
  return Date.parse(text);
}

export function isDateOnly(text: string): boolean {
  return DATE_ONLY.test(text);
}
