import { describe, expect, it } from 'vitest';
import { checkRule, parseRule } from './query-rules.js';

const COUNTS = { total: 10, negative: 3, windowTotal: 20 };

describe('parseRule', () => {
  it('should read a measure, a comparison and a number when the rule is well formed', () => {
    expect(parseRule('negative-rate <= 0.2')).toEqual({
      rule: { measure: 'negative-rate', op: '<=', limit: 0.2 },
    });
  });

  it('should read a rule written without spaces when the parts are clear', () => {
    expect(parseRule('count>=50')).toEqual({ rule: { measure: 'count', op: '>=', limit: 50 } });
  });

  it('should name the allowed measures when the measure is unknown', () => {
    expect(parseRule('speed <= 2')).toMatchObject({ problem: expect.stringContaining('count') });
  });

  it('should refuse a rate above 1 when the rule is written', () => {
    expect(parseRule('negative-rate <= 20')).toMatchObject({
      problem: expect.stringContaining('between 0 and 1'),
    });
  });

  it('should refuse a rule with no number when the rule is written', () => {
    expect(parseRule('count >=')).toHaveProperty('problem');
  });
});

describe('checkRule', () => {
  it('should pass when the count is within the limit', () => {
    expect(checkRule('count <= 10', COUNTS)).toEqual({
      rule: 'count <= 10',
      actual: 10,
      status: 'pass',
    });
  });

  it('should fail when the count is over the limit', () => {
    expect(checkRule('count < 10', COUNTS).status).toBe('fail');
  });

  it('should divide the negatives by every rating in the window when the rate is measured', () => {
    expect(checkRule('negative-rate <= 0.15', COUNTS)).toEqual({
      rule: 'negative-rate <= 0.15',
      actual: 0.15,
      status: 'pass',
    });
  });

  it('should be unchecked when the rate is measured over an empty window', () => {
    expect(checkRule('negative-rate <= 0.2', { total: 0, negative: 0, windowTotal: 0 })).toEqual({
      rule: 'negative-rate <= 0.2',
      actual: null,
      status: 'unchecked',
    });
  });

  it('should still check a count when the window is empty', () => {
    expect(checkRule('count <= 0', { total: 0, negative: 0, windowTotal: 0 }).status).toBe('pass');
  });

  it('should be unchecked when the rule text is not a rule', () => {
    expect(checkRule('nonsense', COUNTS).status).toBe('unchecked');
  });

  it('should compare for equality when the operator is =', () => {
    expect(checkRule('negative-count = 3', COUNTS).status).toBe('pass');
  });
});
