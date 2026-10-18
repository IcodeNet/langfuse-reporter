import { describe, expect, it } from 'vitest';
import {
  checkSize,
  CONFIRM_ABOVE_RATINGS,
  estimateMemoryMb,
  REFUSE_ABOVE_RATINGS,
  turnBudgetFor,
} from './size-guard.js';

const TWO_GB = 2_144 * 1_048_576;

describe('checkSize', () => {
  it('should let the run through without asking when it is a normal month', () => {
    expect(checkSize({ ratings: 300, heapLimitBytes: TWO_GB }).verdict).toBe('ok');
  });

  it('should let the run through when it has the largest size that needs no confirmation', () => {
    expect(checkSize({ ratings: CONFIRM_ABOVE_RATINGS, heapLimitBytes: TWO_GB }).verdict).toBe(
      'ok',
    );
  });

  it('should ask first when the run is just over the confirmation size', () => {
    expect(checkSize({ ratings: CONFIRM_ABOVE_RATINGS + 1, heapLimitBytes: TWO_GB }).verdict).toBe(
      'confirm',
    );
  });

  it('should refuse when the run is just over the refusal size', () => {
    expect(checkSize({ ratings: REFUSE_ABOVE_RATINGS + 1, heapLimitBytes: TWO_GB }).verdict).toBe(
      'refuse',
    );
  });

  it('should refuse a smaller run when the memory limit is low', () => {
    expect(checkSize({ ratings: 4_000, heapLimitBytes: 256 * 1_048_576 }).verdict).toBe('refuse');
  });

  it('should tell the user how to shrink the run when it refuses', () => {
    const { advice } = checkSize({ ratings: 40_000, heapLimitBytes: TWO_GB });

    expect(advice).toContain('shorter window');
    expect(advice).toContain('--force-large');
  });

  it('should tell the user how to go ahead when it asks', () => {
    expect(checkSize({ ratings: 6_000, heapLimitBytes: TWO_GB }).advice).toContain('--yes');
  });

  it('should say nothing when the run is fine', () => {
    expect(checkSize({ ratings: 10, heapLimitBytes: TWO_GB }).advice).toBe('');
  });

  it('should name the numbers it judged by when the advice is given', () => {
    const check = checkSize({ ratings: 6_000, heapLimitBytes: TWO_GB });

    expect(check).toMatchObject({ ratings: 6_000, budgetMb: 1_286 });
  });
});

describe('estimateMemoryMb', () => {
  it('should add the same amount when each extra thousand ratings is counted', () => {
    expect(estimateMemoryMb(3_000) - estimateMemoryMb(2_000)).toBe(
      estimateMemoryMb(2_000) - estimateMemoryMb(1_000),
    );
  });

  it.each([
    [1_000, 65],
    [5_000, 187],
    [20_000, 454],
    [50_000, 1_635],
  ])(
    'should stay above what a measured run used when it has %i ratings (%i MB over the start)',
    (ratings, used) => {
      expect(estimateMemoryMb(ratings)).toBeGreaterThan(used);
    },
  );
});

describe('turnBudgetFor', () => {
  it.each([
    [0, 1_000],
    [50, 1_000],
    [1_000, 8_000],
    [5_000, 40_000],
  ])('should allow %i ratings at most %i turns when the lookup runs', (ratings, expected) => {
    expect(turnBudgetFor(ratings)).toBe(expected);
  });
});
