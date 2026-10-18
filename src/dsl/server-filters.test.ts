import { describe, expect, it } from 'vitest';
import type { Expr } from './types.js';
import { parseQuery } from './parse.js';
import { serverFiltersFor } from './server-filters.js';
import { buildFields } from './fields.js';

const NOW = new Date('2026-10-14T10:00:00Z');

function filtersOf(query: string): ReturnType<typeof serverFiltersFor> {
  return serverFiltersFor(parseQuery(query, { now: NOW, fields: buildFields([]) }));
}

describe('serverFiltersFor', () => {
  it('should give nothing when there is no filter', () => {
    expect(serverFiltersFor(undefined)).toEqual({});
  });

  it('should give the trace when the filter pins one trace', () => {
    expect(filtersOf('trace = abc123')).toEqual({ traceId: 'abc123' });
  });

  it('should give the trace and the observation when the filter pins both', () => {
    expect(filtersOf('trace = abc123 AND observation = obs9')).toEqual({
      traceId: 'abc123',
      observationId: 'obs9',
    });
  });

  it('should find the trace when it sits among other conditions joined by AND', () => {
    expect(filtersOf('rating = negative AND trace = abc123 AND has_comment = true')).toEqual({
      traceId: 'abc123',
    });
  });

  it('should give nothing when the trace sits under OR', () => {
    expect(filtersOf('trace = abc123 OR rating = negative')).toEqual({});
  });

  it('should give nothing when the trace sits under NOT', () => {
    expect(filtersOf('NOT trace = abc123')).toEqual({});
  });

  it('should give nothing when the trace is compared with !=', () => {
    expect(filtersOf('trace != abc123')).toEqual({});
  });

  it('should give nothing when two different traces are both required', () => {
    expect(filtersOf('trace = abc123 AND trace = def456')).toEqual({});
  });

  it('should give nothing for the observation when no trace is named, because Langfuse refuses it', () => {
    expect(filtersOf('observation = obs9')).toEqual({});
  });

  it('should leave the session out when the filter names one', () => {
    expect(filtersOf('session = s1')).toEqual({});
  });

  it('should give nothing and not overflow the stack when the tree is far deeper than the parser builds', () => {
    let expr: Expr = { kind: 'cmp', field: 'trace', op: '=', value: 'a' };
    for (let level = 0; level < 200_000; level++) {
      expr = {
        kind: 'and',
        left: expr,
        right: { kind: 'cmp', field: 'rating', op: '=', value: 'negative' },
      };
    }

    expect(serverFiltersFor(expr)).toEqual({});
  });

  it('should still find the trace when the tree is as deep as the parser allows', () => {
    let expr: Expr = { kind: 'cmp', field: 'trace', op: '=', value: 'a' };
    for (let level = 0; level < 64; level++) {
      expr = {
        kind: 'and',
        left: expr,
        right: { kind: 'cmp', field: 'rating', op: '=', value: 'negative' },
      };
    }

    expect(serverFiltersFor(expr)).toEqual({ traceId: 'a' });
  });
});
