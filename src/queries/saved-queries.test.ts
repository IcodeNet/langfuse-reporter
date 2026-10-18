import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_CONVENTIONS, configFileSchema } from '../config/config-schema.js';
import { buildSavedQuery, unknownQueryMessage, withQuery, withoutQuery } from './saved-queries.js';

describe('buildSavedQuery', () => {
  it('should build the query when the filter, window and rules are valid', () => {
    const built = buildSavedQuery(
      'weekly',
      { where: 'rating = negative', window: '7d', rules: ['count <= 5'] },
      DEFAULT_CONVENTIONS,
    );

    expect(built).toEqual({
      query: { where: 'rating = negative', window: '7d', rules: ['count <= 5'] },
    });
  });

  it('should report the filter problem when the filter does not parse', () => {
    const built = buildSavedQuery(
      'weekly',
      { where: 'ratin = negative', rules: [] },
      DEFAULT_CONVENTIONS,
    );

    expect(built).toMatchObject({ problems: [expect.stringContaining('Invalid filter')] });
  });

  it('should report the window problem when the window word is unknown', () => {
    const built = buildSavedQuery(
      'weekly',
      { window: 'fortnight', rules: [] },
      DEFAULT_CONVENTIONS,
    );

    expect(built).toMatchObject({ problems: [expect.stringContaining('window')] });
  });

  it('should report the rule problem with its position when a rule is wrong', () => {
    const built = buildSavedQuery(
      'weekly',
      { rules: ['count <= 5', 'bogus'] },
      DEFAULT_CONVENTIONS,
    );

    expect(built).toMatchObject({ problems: [expect.stringContaining('rules.1')] });
  });

  it('should refuse the name when it has capital letters or spaces', () => {
    const built = buildSavedQuery('My Query', { rules: [] }, DEFAULT_CONVENTIONS);

    expect(built).toMatchObject({ problems: [expect.stringContaining('lowercase')] });
  });

  it('should accept a filter on a reason the config defines when the conventions are custom', () => {
    const built = buildSavedQuery(
      'late',
      { where: 'category IN (too_slow)', rules: [] },
      { ...DEFAULT_CONVENTIONS, reasons: ['too_slow'] },
    );

    expect(built).toHaveProperty('query');
  });
});

describe('withQuery and withoutQuery', () => {
  it('should add the query to the config when it is saved', () => {
    const saved = withQuery(DEFAULT_CONFIG, 'a', { rules: ['count >= 1'] });

    expect(saved.queries).toEqual({ a: { rules: ['count >= 1'] } });
  });

  it('should leave the original config unchanged when a query is added', () => {
    withQuery(DEFAULT_CONFIG, 'a', { rules: [] });

    expect(DEFAULT_CONFIG.queries).toEqual({});
  });

  it('should remove only the named query when it is removed', () => {
    const two = withQuery(withQuery(DEFAULT_CONFIG, 'a', { rules: [] }), 'b', { rules: [] });

    expect(Object.keys(withoutQuery(two, 'a').queries)).toEqual(['b']);
  });

  it('should throw with the saved names when the query to remove does not exist', () => {
    const one = withQuery(DEFAULT_CONFIG, 'a', { rules: [] });

    expect(() => withoutQuery(one, 'z')).toThrow('Saved queries: a');
  });

  it('should say there are none when the config has no saved queries', () => {
    expect(unknownQueryMessage('z', DEFAULT_CONFIG)).toContain('There are none yet');
  });
});

describe('configFileSchema queries', () => {
  it('should round trip the queries when the file is saved and read back', () => {
    const file = withQuery(DEFAULT_CONFIG, 'a', { window: '30d', rules: ['count >= 1'] });

    expect(configFileSchema.parse(JSON.parse(JSON.stringify(file))).queries).toEqual(file.queries);
  });

  it('should default to no queries when the file has none', () => {
    const { queries: _ignored, ...withoutQueries } = DEFAULT_CONFIG;

    expect(configFileSchema.parse(withoutQueries).queries).toEqual({});
  });

  it('should refuse the file when a saved query has an unknown key', () => {
    const bad = { ...DEFAULT_CONFIG, queries: { a: { rules: [], extra: 1 } } };

    expect(configFileSchema.safeParse(bad).success).toBe(false);
  });
});
