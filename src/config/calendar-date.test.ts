import { describe, expect, it } from 'vitest';
import { isDateOnly, parseCalendarDate } from './calendar-date.js';

describe('parseCalendarDate', () => {
  it('should read midnight UTC when the text is a plain date', () => {
    expect(parseCalendarDate('2026-09-01')).toBe(Date.parse('2026-09-01T00:00:00Z'));
  });

  it('should read the instant when the text is a timestamp with a zone', () => {
    expect(parseCalendarDate('2026-09-01T10:30:00Z')).toBe(Date.parse('2026-09-01T10:30:00Z'));
  });

  it.each(['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-02-30T10:00:00Z'])(
    'should refuse the day when %s is impossible, instead of moving it to another month',
    (text) => {
      expect(parseCalendarDate(text)).toBeNaN();
    },
  );

  it.each(['2026-09-01T10:00:00', 'September 1 2026', '09/01/2026', '', '2026-9-1'])(
    'should refuse the text when %j is not an ISO date with a zone',
    (text) => {
      expect(parseCalendarDate(text)).toBeNaN();
    },
  );

  it('should accept 29 February when the year is a leap year and refuse it otherwise', () => {
    expect(parseCalendarDate('2028-02-29')).not.toBeNaN();
    expect(parseCalendarDate('2027-02-29')).toBeNaN();
  });
});

describe('isDateOnly', () => {
  it('should tell a plain date from a timestamp when the text is classified', () => {
    expect(isDateOnly('2026-09-01')).toBe(true);
    expect(isDateOnly('2026-09-01T10:00:00Z')).toBe(false);
  });
});
