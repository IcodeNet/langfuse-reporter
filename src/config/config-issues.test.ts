import { describe, expect, it } from 'vitest';
import { checkConfigText } from './config-store.js';

const VALID = {
  activeProfile: 'dev',
  profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
};

const problemsOf = (file: unknown): string[] => checkConfigText(JSON.stringify(file)).problems;

describe('checkConfigText', () => {
  it('should accept the file when it has only the required settings', () => {
    expect(checkConfigText(JSON.stringify(VALID)).problems).toEqual([]);
  });

  it('should report the problem when the text is not JSON', () => {
    expect(checkConfigText('{ nope').problems[0]).toContain('not valid JSON');
  });

  it('should name the path when a value is wrong', () => {
    expect(problemsOf({ ...VALID, conventions: { turnName: '' } })).toEqual([
      'conventions.turnName: must not be empty',
    ]);
  });

  it('should show the value it found when the value is wrong', () => {
    expect(problemsOf({ ...VALID, conventions: { passLabel: 'x'.repeat(30) } })[0]).toContain(
      '(found "xxxxxxxx',
    );
  });

  it('should suggest the right key when a convention is misspelled', () => {
    expect(problemsOf({ ...VALID, conventions: { turnNmae: 'x' } })).toEqual([
      expect.stringContaining('conventions.turnNmae: not a setting. Did you mean "turnName"?'),
    ]);
  });

  it('should list the allowed keys when nothing is close', () => {
    expect(problemsOf({ ...VALID, conventions: { zzzzzzzz: 'x' } })[0]).toContain(
      'Allowed here: turnName',
    );
  });

  it('should suggest the right key when a key at the top of the file is misspelled', () => {
    expect(problemsOf({ ...VALID, convention: {} })[0]).toContain('Did you mean "conventions"?');
  });

  it('should point at the item when one item of a list is wrong', () => {
    expect(problemsOf({ ...VALID, conventions: { reasons: ['ok', 'ok'] } })[0]).toContain(
      'conventions.reasons[2]: "ok" is listed twice',
    );
  });

  it('should report every problem at once when the file has several', () => {
    const problems = problemsOf({
      ...VALID,
      conventions: { turnName: '', ratingScore: 'a,b', passLabel: '' },
    });

    expect(problems).toHaveLength(3);
  });

  it('should reject the URL and say where it is when it is bad', () => {
    expect(problemsOf({ ...VALID, profiles: { dev: { baseUrl: 'langfuse' } } })[0]).toContain(
      'profiles.dev.baseUrl',
    );
  });

  it('should reject the provider and name the path when it is unknown', () => {
    expect(problemsOf({ ...VALID, llm: { provider: 'bard' } })[0]).toContain('llm.provider');
  });

  it('should not echo control characters when the file contains them', () => {
    const bad = problemsOf({ ...VALID, conventions: { turnName: 'a\u001b[2Jb\nc' } }).join('\n');

    expect(bad).not.toContain('\u001b');
  });

  it('should cut the value in the report when it is very long', () => {
    const long = 'z'.repeat(500);

    expect(problemsOf({ ...VALID, conventions: { turnName: long } })[0]?.length).toBeLessThan(200);
  });

  it('should reject an unknown key at the top of the file when it is not a setting', () => {
    expect(problemsOf({ ...VALID, surprise: 1 })).toHaveLength(1);
  });

  it('should not repeat the value when the message already names it', () => {
    expect(problemsOf({ ...VALID, conventions: { reasons: ['a', 'a'] } })).toEqual([
      'conventions.reasons[2]: "a" is listed twice',
    ]);
  });
});
