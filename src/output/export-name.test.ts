import { describe, expect, it } from 'vitest';
import {
  boundaryLabel,
  exportStem,
  queryFingerprint,
  slugifyQuery,
  validateCustomName,
} from './export-name.js';

describe('slugifyQuery', () => {
  it('should read like the filter when the query is simple', () => {
    expect(slugifyQuery('rating = negative AND has_comment = true')).toBe(
      'rating-negative-and-has_comment-true',
    );
  });

  it('should spell out comparison symbols when the query compares dates', () => {
    expect(slugifyQuery('created >= 2026-09-15')).toBe('created-gte-2026-09-15');
  });

  it('should keep list members when the query uses IN', () => {
    expect(slugifyQuery('category IN (other_issue, wrong_answer)')).toBe(
      'category-in-other_issue-wrong_answer',
    );
  });

  it('should drop quotes and path characters when the query searches text', () => {
    expect(slugifyQuery('comment CONTAINS "../../etc/passwd"')).toBe('comment');
  });

  it('should cut a very long query at 60 characters when the filter is huge', () => {
    expect(
      slugifyQuery(Array(30).fill('rating = negative').join(' OR ')).length,
    ).toBeLessThanOrEqual(60);
  });

  it('should return an empty string when the query has no usable characters', () => {
    expect(slugifyQuery('"""')).toBe('');
  });
});

describe('slugifyQuery private values', () => {
  it.each([
    ['user = U-4471', 'user'],
    ['comment CONTAINS "my account 12345"', 'comment'],
    ['session = abc-123 AND rating = negative', 'session-and-rating-negative'],
    ['trace = 886caa31', 'trace'],
    ['rating = negative AND user = "jane doe"', 'rating-negative-and-user'],
  ])('should leave the value out of the name when the filter is %j', (query, expected) => {
    expect(slugifyQuery(query)).toBe(expected);
  });

  it('should keep the value of a field that holds no personal data when the filter has one', () => {
    expect(slugifyQuery('env = uat-like AND rating = negative')).toBe(
      'env-uat-like-and-rating-negative',
    );
  });
});

describe('queryFingerprint', () => {
  it('should differ when two queries slugify the same but are not the same', () => {
    expect(queryFingerprint('rating = negative')).not.toBe(queryFingerprint('rating != negative'));
  });

  it('should be sixteen hex characters when given any query', () => {
    expect(queryFingerprint('rating = negative')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should ignore surrounding spaces when the same query is retyped', () => {
    expect(queryFingerprint('  rating = negative ')).toBe(queryFingerprint('rating = negative'));
  });
});

describe('exportStem', () => {
  const from = '2026-09-01T00:00:00.000Z';
  const to = '2026-10-01T00:00:00.000Z';

  it('should include the window, the readable query and a fingerprint when a query is given', () => {
    expect(exportStem({ from, to, query: 'rating = negative' })).toMatch(
      /^2026-09-01_2026-10-01_rating-negative_[0-9a-f]{16}$/,
    );
  });

  it('should say "all" when there is no query', () => {
    expect(exportStem({ from, to, query: undefined })).toMatch(
      /^2026-09-01_2026-10-01_all_[0-9a-f]{16}$/,
    );
  });

  it('should use the custom name when the user chose one', () => {
    expect(
      exportStem({ from, to, query: 'rating = negative', customName: 'q3-complaints' }),
    ).toMatch(/^2026-09-01_2026-10-01_q3-complaints_[0-9a-f]{16}$/);
  });

  it('should give different names when the queries differ but read the same', () => {
    const a = exportStem({ from, to, query: 'rating = negative' });
    const b = exportStem({ from, to, query: 'rating != negative' });

    expect(a).not.toBe(b);
  });

  it('should give different names when the periods differ', () => {
    const a = exportStem({ from, to, query: 'rating = negative' });
    const b = exportStem({
      from: '2026-08-01T00:00:00.000Z',
      to: from,
      query: 'rating = negative',
    });

    expect(a).not.toBe(b);
  });
});

describe('validateCustomName', () => {
  it.each(['../x', 'a/b', 'a b', '.hidden', '', 'x'.repeat(61)])(
    'should refuse %j when the name could be unsafe',
    (name) => {
      expect(() => validateCustomName(name)).toThrow('is not a usable file name');
    },
  );

  it('should accept letters, digits, hyphens and underscores when the name is plain', () => {
    expect(validateCustomName('Q3_complaints-v2')).toBe('Q3_complaints-v2');
  });
});

describe('boundaryLabel', () => {
  it('should show only the date when the boundary is midnight UTC', () => {
    expect(boundaryLabel('2026-09-01T00:00:00.000Z')).toBe('2026-09-01');
  });

  it('should keep the full time when the boundary is not midnight, with no colon or dot in the name', () => {
    expect(boundaryLabel('2026-09-01T10:30:05.250Z')).toBe('2026-09-01T10-30-05-250');
  });

  it('should tell the boundaries apart when they differ by one second', () => {
    expect(boundaryLabel('2026-09-01T10:00:01.000Z')).not.toBe(
      boundaryLabel('2026-09-01T10:00:59.000Z'),
    );
  });

  it('should treat the boundary as a time when it is one millisecond after midnight', () => {
    expect(boundaryLabel('2026-09-01T00:00:00.001Z')).toBe('2026-09-01T00-00-00-001');
  });

  it('should give same-day windows different names when their times differ', () => {
    const a = exportStem({
      from: '2026-09-01T10:00:00.000Z',
      to: '2026-09-01T12:00:00.000Z',
      query: undefined,
    });
    const b = exportStem({
      from: '2026-09-01T11:00:00.000Z',
      to: '2026-09-01T13:00:00.000Z',
      query: undefined,
    });

    expect(a).not.toBe(b);
  });

  it('should keep a name that is safe to use as a file name when the boundary has a time', () => {
    const stem = exportStem({
      from: '2026-09-01T10:00:00.000Z',
      to: '2026-09-01T12:00:00.000Z',
      query: undefined,
    });

    expect(stem).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});
