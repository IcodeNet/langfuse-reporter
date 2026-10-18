import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeedbackRow } from '../dsl/types.js';
import { isFilterLine, suggestForLine, type SuggestEnv } from './suggest-line.js';

function makeRow(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    traceId: 't1',
    sessionId: 's1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: '',
    environment: 'uat-like',
    created: Date.parse('2026-09-15T08:00:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    ...overrides,
  };
}

const env: SuggestEnv = {
  context: {
    now: new Date('2026-10-12T10:00:00Z'),
    dynamicValues: { env: ['uat-like', 'preprod'] },
  },
  profiles: ['dev', 'prod'],
  rows: [makeRow(), makeRow({ rating: 'positive' }), makeRow({ rating: 'positive' })],
};

const inserts = (line: string, e: SuggestEnv = env): string[] =>
  suggestForLine(line, e).suggestions.map((suggestion) => suggestion.insert);

describe('suggestForLine', () => {
  it('should offer commands and filter fields together when the line is empty', () => {
    expect(inserts('')).toEqual(expect.arrayContaining(['where', 'export', 'rating', 'category']));
  });

  it('should narrow to matching commands and fields when the first word is partial', () => {
    expect(inserts('ex')).toEqual(['export', 'exit']);
  });

  it('should treat a line as a filter when its first word is not a command', () => {
    expect(isFilterLine('rating = negative')).toBe(true);
  });

  it('should treat a line as a command when its first word is a command', () => {
    expect(isFilterLine('export where rating = negative')).toBe(false);
  });

  it('should offer the ratings when a filter has reached the value', () => {
    expect(inserts('rating = ')).toEqual(['positive', 'negative']);
  });

  it('should offer the filter fields again when a command expects a filter', () => {
    expect(inserts('where ')).toContain('rating');
  });

  it('should offer filter fields after export where when exporting a subset', () => {
    expect(inserts('export where ')).toContain('category');
  });

  it('should offer only the where keyword when completing after export', () => {
    expect(inserts('export ')).toEqual(['where']);
  });

  it('should offer the known profile names when switching profiles', () => {
    expect(inserts('use ')).toEqual(['dev', 'prod']);
  });

  it('should offer the supported model providers when setting llm.provider', () => {
    expect(inserts('set llm.provider ')).toEqual(['litellm', 'openai', 'anthropic', 'gemini']);
  });

  it('should offer the settable keys when setting with no key yet', () => {
    expect(inserts('set ')).toContain('profile.envFile');
  });

  it('should report how many ratings match when the filter is valid', () => {
    expect(suggestForLine('rating = negative', env).message).toEqual({
      kind: 'info',
      text: '1 of 3 ratings match',
    });
  });

  it('should stay quiet about errors when the last word can still be completed', () => {
    expect(suggestForLine('rating = ne', env).message).toBeUndefined();
  });

  it('should still offer the completion when the last word is a valid prefix', () => {
    expect(inserts('rating = ne')).toEqual(['negative']);
  });

  it('should report the mistake when the word can no longer be completed', () => {
    expect(suggestForLine('rating = negitive ', env).message).toEqual({
      kind: 'error',
      text: '^ "negitive" is not a valid rating. Did you mean "negative"? Valid: positive, negative',
    });
  });

  it('should offer nothing else when the filter already has an error', () => {
    expect(inserts('rating = negitive ')).toEqual([]);
  });

  it('should ask to load first when no ratings are loaded', () => {
    const unloaded: SuggestEnv = { ...env, rows: undefined };

    expect(suggestForLine('rating = negative', unloaded).message?.text).toBe(
      'run "load" first to see live match counts',
    );
  });

  it('should offer config and its sub-commands when typing config', () => {
    expect(inserts('config ')).toEqual(['show', 'check', 'set', 'unset', 'use']);
  });

  it('should narrow config sub-commands when the sub-command is partial', () => {
    expect(inserts('config u')).toEqual(['unset', 'use']);
  });

  it('should offer the settable keys when completing config set', () => {
    expect(inserts('config set ')).toContain('profile.envFile');
  });

  it('should offer the supported model providers when completing config set llm.provider', () => {
    expect(inserts('config set llm.provider ')).toEqual([
      'litellm',
      'openai',
      'anthropic',
      'gemini',
    ]);
  });

  it('should offer the settable keys when completing config unset', () => {
    expect(inserts('config unset o')).toEqual(['outDir']);
  });

  it('should offer the known profile names when completing config use', () => {
    expect(inserts('config use ')).toEqual(['dev', 'prod']);
  });

  it('should say what to type when a setting takes a free-text value', () => {
    expect(suggestForLine('config set outDir ', env).suggestions[0]?.hint).toBe(
      'type the new value: folder the Excel files are written to',
    );
  });

  it('should warn about the sub-command when it is unknown', () => {
    expect(suggestForLine('config bogus ', env).suggestions[0]?.hint).toContain(
      'unknown "config bogus"',
    );
  });

  it('should say Enter runs the check when completing config check', () => {
    expect(suggestForLine('config check ', env).suggestions[0]?.hint).toBe(
      'press Enter to check the config file',
    );
  });

  it('should offer the settable keys when completing unset', () => {
    expect(inserts('unset ')).toContain('llm.model');
  });

  it('should offer nothing more when unset already has its key', () => {
    expect(suggestForLine('unset outDir ', env).suggestions[0]?.hint).toBe(
      'press Enter to reset it to its default',
    );
  });

  it('should explain each provider when completing llm.provider', () => {
    expect(suggestForLine('set llm.provider lit', env).suggestions[0]?.hint).toContain(
      'LiteLLM gateway',
    );
  });

  it('should warn about an unknown setting key when setting', () => {
    expect(suggestForLine('set nonsense ', env).suggestions[0]?.hint).toContain('unknown setting');
  });

  it.each(['load ', 'fields ', 'profiles ', 'exit '])(
    'should say Enter runs the command when %s takes no argument',
    (line) => {
      expect(suggestForLine(line, env).suggestions[0]?.hint).toContain('press Enter');
    },
  );

  it('should not treat quit as a filter when it is typed', () => {
    expect(isFilterLine('quit')).toBe(false);
  });

  it('should list unset among the commands when the line is empty', () => {
    expect(inserts('')).toContain('unset');
  });

  it('should offer the table columns when completing columns', () => {
    expect(inserts('columns ')).toEqual(
      expect.arrayContaining(['date', 'rating', 'reasons', 'question', 'reset']),
    );
  });

  it('should narrow the table columns when the column is partial', () => {
    expect(inserts('columns re')).toEqual(['reasons', 'reset']);
  });

  it('should explain the optional name when completing save', () => {
    expect(suggestForLine('save ', env).suggestions[0]?.hint).toContain('optional file name');
  });

  it('should list save and columns among the commands when the line is empty', () => {
    expect(inserts('')).toEqual(expect.arrayContaining(['save', 'columns', 'docs']));
  });

  it('should list credits among the commands when the commands are suggested', () => {
    expect(inserts('')).toContain('credits');
    expect(suggestForLine('credits ', env).suggestions[0]?.hint).toBeUndefined();
  });

  it('should not read /credits as a filter when it is typed', () => {
    expect(isFilterLine('/credits')).toBe(false);
  });

  it('should list clear among the commands when the commands are suggested', () => {
    expect(inserts('')).toContain('clear');
    expect(suggestForLine('clear ', env).suggestions[0]?.hint).toContain('clear the screen');
  });

  it('should offer check when the config sub-commands are suggested', () => {
    expect(inserts('config c')).toEqual(['check']);
  });

  it('should offer the convention keys when completing config set', () => {
    expect(inserts('config set conv')).toEqual(
      expect.arrayContaining(['conventions.turnName', 'conventions.reasons']),
    );
  });
});

describe('suggestForLine help requests', () => {
  const insertsOf = (line: string): string[] =>
    suggestForLine(line, env).suggestions.map((suggestion) => suggestion.insert);

  it('should offer report when the user starts typing it', () => {
    expect(insertsOf('rep')).toEqual(['report']);
  });

  it('should offer a filter when report where is typed', () => {
    expect(insertsOf('report where ')).toContain('rating');
  });

  it.each(['where', 'window', 'columns', 'export', 'report', 'set', 'use'])(
    'should offer --help when %s is followed by a space and a dash',
    (command) => {
      expect(insertsOf(`${command} -`)).toEqual(['--help']);
    },
  );

  it('should not call a question mark after where a filter error when the user is asking for help', () => {
    const hints = suggestForLine('where ?', env);

    expect([hints.message?.kind, hints.suggestions[0]?.hint]).toEqual([
      undefined,
      'press Enter to read how "where" works',
    ]);
  });

  it('should confirm what Enter does when --help is fully typed', () => {
    expect(suggestForLine('export --help', env).suggestions[0]?.hint).toBe(
      'press Enter to read how "export" works',
    );
  });

  it('should list the command names when help is followed by a space', () => {
    expect(insertsOf('help ')).toEqual(
      expect.arrayContaining(['where', 'window', 'report', 'exit']),
    );
  });

  it('should narrow the command names when help is followed by a few letters', () => {
    expect(insertsOf('help wh')).toEqual(['where']);
  });

  it('should treat a question mark as a filter mistake when it follows an unknown word', () => {
    expect(suggestForLine('foo ?', env).message?.kind).toBe('error');
  });
});

describe('suggestForLine window', () => {
  const windowInserts = (line: string): string[] =>
    suggestForLine(line, env).suggestions.map((suggestion) => suggestion.insert);

  it('should offer every preset word when window is typed with a space', () => {
    expect(windowInserts('window ')).toEqual(
      expect.arrayContaining([
        'today',
        'yesterday',
        '7d',
        'last-week',
        'this-month',
        'last-month',
        'reset',
      ]),
    );
  });

  it('should narrow the presets when letters are typed after window', () => {
    expect(windowInserts('window la')).toEqual(['last-week', 'last-month']);
  });

  it('should show the dates each preset means when the presets are suggested', () => {
    const hint =
      suggestForLine('window ', env).suggestions.find((s) => s.insert === 'today')?.hint ?? '';

    expect(hint).toMatch(/^\d{4}-\d{2}-\d{2}: today only$/);
  });

  it('should say Enter loads the window when a preset is typed whole', () => {
    expect(suggestForLine('window 7d ', env).suggestions[0]?.hint).toBe(
      'press Enter to load this window',
    );
  });
});

describe('suggestForLine compare', () => {
  let reports = '';
  let withReports: SuggestEnv = env;

  beforeAll(() => {
    reports = mkdtempSync(join(tmpdir(), 'compare-hints-'));
    writeReport('first.xlsx', '2026-10-10T10:00:00Z');
    writeReport('second.xlsx', '2026-10-12T10:00:00Z');
    writeReport('third.xlsx', '2026-10-14T10:00:00Z');
    withReports = { ...env, reportsDir: reports };
  });

  afterAll(() => rmSync(reports, { recursive: true, force: true }));

  function writeReport(name: string, when: string): void {
    writeFileSync(join(reports, name), 'x');
    utimesSync(join(reports, name), new Date(when), new Date(when));
  }

  it('should offer every report newest first when the first file of compare is typed', () => {
    expect(inserts('compare ', withReports)).toEqual(['third.xlsx', 'second.xlsx', 'first.xlsx']);
  });

  it('should narrow the files when letters are typed after compare', () => {
    expect(inserts('compare se', withReports)).toEqual(['second.xlsx']);
  });

  it('should offer the other files and hide the chosen one when the second argument of compare is typed', () => {
    expect(inserts('compare first.xlsx ', withReports)).toEqual(['third.xlsx', 'second.xlsx']);
  });

  it('should show when each file was written in its hint', () => {
    const hint = suggestForLine('compare ', withReports).suggestions[0]?.hint ?? '';

    expect(hint).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}, \d+ KB$/);
  });

  it('should say it is ready when two files are chosen', () => {
    expect(
      suggestForLine('compare first.xlsx second.xlsx ', withReports).suggestions[0]?.hint,
    ).toBe('press Enter to compare');
  });

  it('should leave the shell to complete the path when the user types a folder part', () => {
    expect(suggestForLine('compare ./rep', withReports).suggestions).toEqual([
      { insert: '', hint: 'the older report file (.xlsx), then the newer one' },
    ]);
  });

  it('should say no report was found and how to make one when the folder is empty', () => {
    const empty = { ...env, reportsDir: mkdtempSync(join(tmpdir(), 'compare-empty-')) };

    expect(suggestForLine('compare ', empty).suggestions[0]?.hint).toBe(
      'the older report file (.xlsx), then the newer one; none found in the reports folder (export one first)',
    );
  });

  it('should still say which file is expected when no reports folder is known', () => {
    expect(suggestForLine('compare ', env).suggestions[0]?.hint).toBe(
      'the older report file (.xlsx), then the newer one; none found in the reports folder (export one first)',
    );
  });
});
