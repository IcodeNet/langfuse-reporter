import { describe, expect, it } from 'vitest';
import { complete } from './complete.js';
import { isLangfuseOwnedEnvironment } from './fields.js';
import { matches } from './evaluate.js';
import { parseQuery } from './parse.js';
import { tokenize } from './tokenize.js';
import { QueryError, type Expr, type FeedbackRow, type ParseContext } from './types.js';

const context: ParseContext = {
  now: new Date('2026-10-12T10:00:00Z'),
  dynamicValues: { env: ['uat-like', 'preprod'] },
};

function makeRow(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    traceId: 'trace-1',
    sessionId: 'session-1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: 'Not very proactive',
    environment: 'uat-like',
    created: Date.parse('2026-09-15T08:58:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    ...overrides,
  };
}

function run(query: string, row: FeedbackRow): boolean {
  return matches(parseQuery(query, context), row);
}

describe('tokenize', () => {
  it('should keep quoted text as one token when it contains spaces', () => {
    const tokens = tokenize('comment CONTAINS "not very"');

    expect(tokens.map((token) => token.text)).toEqual(['comment', 'CONTAINS', 'not very']);
  });

  it('should throw a positioned error when a quote is never closed', () => {
    expect(() => tokenize('comment = "oops')).toThrow(QueryError);
  });
});

describe('parseQuery', () => {
  it('should return undefined when the query is blank', () => {
    expect(parseQuery('   ', context)).toBeUndefined();
  });

  it('should suggest the closest rating when the value is misspelled', () => {
    expect(() => parseQuery('rating = negitive', context)).toThrow('Did you mean "negative"?');
  });

  it('should suggest the closest field when the field name is misspelled', () => {
    expect(() => parseQuery('categry = other', context)).toThrow('Did you mean "category"?');
  });

  it('should list the allowed operators when one is not valid for the field', () => {
    expect(() => parseQuery('rating > negative', context)).toThrow('Allowed: =, !=, in');
  });

  it('should report the character position of the first mistake when a filter has several', () => {
    const error = (() => {
      try {
        parseQuery('rating = negative AND env = prepod', context);
      } catch (err) {
        return err as QueryError;
      }
      return undefined;
    })();

    expect(error?.position).toBe(28);
  });

  it('should reject an environment when it is not in the live project values', () => {
    expect(() => parseQuery('env = prod', context)).toThrow('Valid: uat-like, preprod');
  });

  it('should reject text that is not a date when the field is a date', () => {
    expect(() => parseQuery('created >= septmber', context)).toThrow('is not a real date');
  });

  it.each(['2026-02-30', '2026-04-31', '2026-13-01'])(
    'should reject the impossible day %s when it is typed in a filter',
    (day) => {
      expect(() => parseQuery(`created >= ${day}`, context)).toThrow('is not a real date');
    },
  );

  it('should accept 29 February when the year is a leap year', () => {
    expect(() => parseQuery('created >= 2028-02-29', context)).not.toThrow();
  });

  it('should reject a dangling AND when the right-hand side is missing', () => {
    expect(() => parseQuery('rating = negative AND', context)).toThrow('Query ended early');
  });
});

describe('parseQuery limits', () => {
  it('should reject a filter nested deeper than 64 levels when NOT is repeated', () => {
    expect(() => parseQuery(`${'NOT '.repeat(65)}rating = negative`, context)).toThrow(
      'nested more than 64 levels',
    );
  });

  it('should reject a filter nested deeper than 64 levels when brackets are repeated', () => {
    expect(() =>
      parseQuery(`${'('.repeat(65)}rating = negative${')'.repeat(65)}`, context),
    ).toThrow('nested more than 64 levels');
  });

  it('should accept a filter nested exactly 64 levels when NOT is repeated', () => {
    expect(() => parseQuery(`${'NOT '.repeat(64)}rating = negative`, context)).not.toThrow();
  });

  it('should reject a filter with more than 200 conditions when AND is chained', () => {
    const filter = Array.from({ length: 201 }, () => 'rating = negative').join(' AND ');

    expect(() => parseQuery(filter, context)).toThrow('more than 200 conditions');
  });

  it('should accept a filter with exactly 200 conditions when OR is chained', () => {
    const filter = Array.from({ length: 200 }, () => 'rating = negative').join(' OR ');

    expect(() => parseQuery(filter, context)).not.toThrow();
  });

  it('should point at the nesting that went too deep when reporting the error', () => {
    const filter = `${'('.repeat(65)}rating = negative${')'.repeat(65)}`;
    let position = -1;
    try {
      parseQuery(filter, context);
    } catch (err) {
      position = (err as QueryError).position;
    }

    expect(position).toBe(64);
  });
});

describe('evaluating the largest filter the parser accepts', () => {
  it('should evaluate 200 chained conditions without overflowing when the filter is at the limit', () => {
    const filter = Array.from({ length: 200 }, () => 'rating = negative').join(' AND ');

    expect(run(filter, makeRow())).toBe(true);
  });

  it('should evaluate 64 nested NOTs without overflowing when the filter is at the limit', () => {
    expect(run(`${'NOT '.repeat(64)}rating = negative`, makeRow())).toBe(true);
  });

  it('should evaluate 64 brackets around 200 conditions when both limits are used together', () => {
    const chain = Array.from({ length: 200 }, () => 'rating = negative').join(' OR ');

    expect(run(`${'('.repeat(64)}${chain}${')'.repeat(64)}`, makeRow())).toBe(true);
  });
});

describe('matches', () => {
  it('should match every row when there is no filter', () => {
    expect(matches(undefined, makeRow())).toBe(true);
  });

  it('should be case-insensitive when matching an enum value', () => {
    expect(run('rating = NEGATIVE', makeRow())).toBe(true);
  });

  it('should match when any ticked category is in the list', () => {
    const row = makeRow({ categories: ['other_issue', 'wrong_answer'] });

    expect(run('category IN (wrong_answer, well_explained)', row)).toBe(true);
  });

  it('should not match != on a category when the row ticked that category', () => {
    const row = makeRow({ categories: ['other_issue', 'wrong_answer'] });

    expect(run('category != other_issue', row)).toBe(false);
  });

  it('should include the whole day when a date-only value is used with <=', () => {
    const row = makeRow({ created: Date.parse('2026-09-15T23:30:00Z') });

    expect(run('created <= 2026-09-15', row)).toBe(true);
  });

  it('should exclude the day itself when a date-only value is used with >', () => {
    const row = makeRow({ created: Date.parse('2026-09-15T23:30:00Z') });

    expect(run('created > 2026-09-15', row)).toBe(false);
  });

  it('should match any time on the day when a date-only value is used with =', () => {
    const row = makeRow({ created: Date.parse('2026-09-15T23:30:00Z') });

    expect(run('created = 2026-09-15', row)).toBe(true);
  });

  it('should not match the next day when a date-only value is used with =', () => {
    const row = makeRow({ created: Date.parse('2026-09-16T00:00:00Z') });

    expect(run('created = 2026-09-15', row)).toBe(false);
  });

  it('should exclude every time on the day when a date-only value is used with !=', () => {
    const row = makeRow({ created: Date.parse('2026-09-15T23:30:00Z') });

    expect(run('created != 2026-09-15', row)).toBe(false);
  });

  it('should include other days when a date-only value is used with !=', () => {
    const row = makeRow({ created: Date.parse('2026-09-14T23:59:59Z') });

    expect(run('created != 2026-09-15', row)).toBe(true);
  });

  it('should keep an exact moment exact when a time is given with =', () => {
    const row = makeRow({ created: Date.parse('2026-09-15T10:00:00Z') });

    expect(run('created = 2026-09-15T10:00:00Z', row)).toBe(true);
  });

  it('should resolve relative dates against the supplied clock when a date is written as 7d', () => {
    const row = makeRow({ created: Date.parse('2026-10-10T00:00:00Z') });

    expect(run('created >= -7d', row)).toBe(true);
  });

  it('should search comments without regard to case when using CONTAINS', () => {
    expect(run('comment CONTAINS "PROACTIVE"', makeRow())).toBe(true);
  });

  it('should bind AND tighter than OR when no brackets are used', () => {
    const row = makeRow({ rating: 'positive', environment: 'uat-like' });

    expect(run('rating = negative AND env = preprod OR env = uat-like', row)).toBe(true);
  });

  it('should honour brackets when they override precedence', () => {
    const row = makeRow({ rating: 'positive', environment: 'uat-like' });

    expect(run('rating = negative AND (env = preprod OR env = uat-like)', row)).toBe(false);
  });

  it('should treat has_comment as false when the comment is empty', () => {
    expect(run('has_comment = false', makeRow({ comment: '' }))).toBe(true);
  });
});

describe('complete', () => {
  it('should offer every field when the query is empty', () => {
    const { suggestions } = complete('', context);

    expect(suggestions.map((s) => s.insert)).toEqual([
      'rating',
      'category',
      'env',
      'created',
      'comment',
      'has_comment',
      'user',
      'trace',
      'session',
      'observation',
      'NOT',
    ]);
  });

  it('should offer only the operators valid for the field when a field was just typed', () => {
    const { suggestions } = complete('rating ', context);

    expect(suggestions.map((s) => s.insert)).toEqual(['=', '!=', 'IN']);
  });

  it('should offer the rating values when the operator was just typed', () => {
    const { suggestions } = complete('rating = ', context);

    expect(suggestions.map((s) => s.insert)).toEqual(['positive', 'negative']);
  });

  it('should narrow values by the partial word when one is being typed', () => {
    const { suggestions, replaceFrom } = complete('rating = neg', context);

    expect(suggestions.map((s) => s.insert)).toEqual(['negative']);
    expect(replaceFrom).toBe(9);
  });

  it('should offer the live environments when completing env', () => {
    const { suggestions } = complete('env = ', context);

    expect(suggestions.map((s) => s.insert)).toEqual(['uat-like', 'preprod']);
  });

  it('should offer AND and OR when a condition is complete', () => {
    const { suggestions } = complete('rating = negative ', context);

    expect(suggestions.map((s) => s.insert)).toEqual(['AND', 'OR', ')']);
  });

  it('should offer the category values again when a list item was followed by a comma', () => {
    const { suggestions } = complete('category IN (other_issue, ', context);

    expect(suggestions.map((s) => s.insert)).toContain('wrong_answer');
  });

  it('should offer date shortcuts when completing a date value', () => {
    const { suggestions } = complete('created >= ', context);

    expect(suggestions.map((s) => s.insert)).toEqual(['today', 'yesterday', '-7d', '-30d', '-12h']);
  });

  it('should offer nothing when the query is already invalid', () => {
    expect(complete('rating rating ', context).suggestions).toEqual([]);
  });
});

describe('matches depth limit', () => {
  const leaf: Expr = { kind: 'cmp', field: 'rating', op: '=', value: 'negative' };

  function nestedNot(levels: number): Expr {
    let expr: Expr = leaf;
    for (let level = 0; level < levels; level++) expr = { kind: 'not', operand: expr };
    return expr;
  }

  it('should evaluate a tree as deep as the parser allows when it is built at the limit', () => {
    expect(() => matches(nestedNot(64), makeRow())).not.toThrow();
  });

  it('should refuse the filter when it nests far deeper than the parser can build', () => {
    expect(() => matches(nestedNot(5_000), makeRow())).toThrow('nested more than');
  });
});

describe('environments Langfuse owns', () => {
  const names = [
    'default',
    'development',
    'eval',
    'uat-like',
    'langfuse-llm-as-a-judge',
    'preprod',
    'sdk-experiment',
    'sdk-experiment-2',
  ];

  it('should name the Langfuse-owned environments when asked which are hidden', () => {
    expect(names.filter((name) => isLangfuseOwnedEnvironment(name))).toEqual([
      'default',
      'langfuse-llm-as-a-judge',
      'sdk-experiment',
      'sdk-experiment-2',
    ]);
  });

  it('should offer only the suggested values after env = when a suggestion list is given', () => {
    const envContext = {
      now: new Date('2026-10-14T10:00:00Z'),
      dynamicValues: { env: names },
      suggestedValues: { env: ['development', 'eval', 'uat-like', 'preprod'] },
    };

    expect(
      complete('env = ', envContext).suggestions.map((suggestion) => suggestion.insert),
    ).toEqual(['development', 'eval', 'uat-like', 'preprod']);
  });

  it('should still accept a hidden environment when it is typed in full', () => {
    const envContext = {
      now: new Date('2026-10-14T10:00:00Z'),
      dynamicValues: { env: names },
      suggestedValues: { env: ['uat-like'] },
    };

    expect(parseQuery('env = default', envContext)).toEqual({
      kind: 'cmp',
      field: 'env',
      op: '=',
      value: 'default',
    });
  });
});
