import { describe, expect, it } from 'vitest';
import { makeMockResolvedConfig } from '../config/__mocks__/makeMockResolvedConfig.mock.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { criteriaBlock, describeCriteria, summariseWindow } from './search-criteria.js';

function makeResolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return makeMockResolvedConfig(overrides);
}

describe('describeCriteria', () => {
  it('should name the Langfuse address and the profile when describing the source', () => {
    expect(describeCriteria(makeResolved(), undefined).source).toBe(
      'https://cloud.langfuse.com (profile dev)',
    );
  });

  it('should say the end date is not included when the user chose the dates', () => {
    expect(describeCriteria(makeResolved({ windowIsDefault: false }), undefined).window).toBe(
      'ratings given from 2026-09-01 up to but not including 2026-10-01 (UTC)',
    );
  });

  it('should show the filter text exactly as typed when a filter is given', () => {
    expect(describeCriteria(makeResolved(), 'rating = negative').filter).toBe('rating = negative');
  });

  it('should say every rating is kept when no filter is given', () => {
    expect(describeCriteria(makeResolved(), undefined).filter).toBe(
      'none, every rating in the window is kept',
    );
  });

  it('should treat a blank filter as no filter when the text is only spaces', () => {
    expect(describeCriteria(makeResolved(), '   ').filter).toContain('none');
  });

  it('should say where the question and answer text comes from when describing the run', () => {
    expect(describeCriteria(makeResolved(), undefined).text).toContain(
      'question and answer of each rated turn',
    );
  });
});

describe('the project', () => {
  it('should name the project when it is known', () => {
    expect(describeCriteria(makeResolved(), undefined, 'acme-development').source).toContain(
      'project acme-development',
    );
  });

  it('should leave the project out when it is not known yet', () => {
    expect(describeCriteria(makeResolved(), undefined).source).not.toContain('project');
  });
});

describe('the default window', () => {
  it('should say it is the previous calendar month when no dates were given', () => {
    expect(describeCriteria(makeResolved(), undefined).window).toContain(
      'Default: the whole previous calendar month. Change it with --from and --to',
    );
  });

  it('should not claim a default when the user chose the dates', () => {
    expect(
      describeCriteria(makeResolved({ windowIsDefault: false }), undefined).window,
    ).not.toContain('Default');
  });
});

describe('summariseWindow', () => {
  it('should show dates only when the window has times', () => {
    expect(summariseWindow(makeResolved())).toBe('2026-09-01 → 2026-10-01');
  });
});

describe('criteriaBlock', () => {
  it('should title the block Search criteria when built', () => {
    expect(criteriaBlock(describeCriteria(makeResolved(), undefined)).title).toBe(
      'Search criteria',
    );
  });

  it('should list the five criteria in reading order when built', () => {
    const labels = criteriaBlock(describeCriteria(makeResolved(), undefined)).rows.map(
      ([label]) => label,
    );

    expect(labels).toEqual(['reading from', 'fetching', 'date window', 'filter', 'shown with']);
  });

  it('should carry the filter text when a filter is given', () => {
    const rows = criteriaBlock(describeCriteria(makeResolved(), 'rating = negative')).rows;

    expect(rows[3]).toEqual(['filter', 'rating = negative']);
  });
});

describe('describeCriteria part-day windows', () => {
  it('should keep the times when the window starts and ends inside a day', () => {
    const resolved = makeResolved({
      windowIsDefault: false,
      from: '2026-10-14T10:00:00.000Z',
      to: '2026-10-14T12:00:00.000Z',
    });

    expect(describeCriteria(resolved, undefined).window).toBe(
      'ratings given from 2026-10-14T10:00:00.000Z up to but not including 2026-10-14T12:00:00.000Z (UTC)',
    );
  });

  it('should show plain dates when the window is whole days', () => {
    const resolved = makeResolved({
      windowIsDefault: false,
      from: '2026-10-13T00:00:00.000Z',
      to: '2026-10-15T00:00:00.000Z',
    });

    expect(describeCriteria(resolved, undefined).window).toBe(
      'ratings given from 2026-10-13 up to but not including 2026-10-15 (UTC)',
    );
  });
});
