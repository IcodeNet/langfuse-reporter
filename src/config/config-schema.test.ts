import { describe, expect, it } from 'vitest';
import {
  configFileSchema,
  conventionsSchema,
  DEFAULT_CONFIG,
  DEFAULT_CONVENTIONS,
  SETTABLE_KEYS,
  SETTING_DESCRIPTIONS,
} from './config-schema.js';

describe('conventionsSchema defaults', () => {
  it('should default to the standard names when nothing is given', () => {
    expect(conventionsSchema.parse({})).toMatchObject({
      turnName: 'chat-turn',
      ratingScore: 'feedback_helpful',
      reasonScorePrefix: 'feedback_',
      yesValues: ['true', '1'],
      assistantName: 'Assistant',
      passLabel: 'Pass',
      failLabel: 'Fail',
    });
  });

  it('should list the twelve known reasons when no reasons are configured', () => {
    expect(DEFAULT_CONVENTIONS.reasons).toHaveLength(12);
    expect(DEFAULT_CONVENTIONS.reasons).toContain('wrong_answer');
  });

  it('should fill the conventions with defaults when the file has none', () => {
    const file = configFileSchema.parse({
      activeProfile: 'dev',
      profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
    });

    expect(file.conventions).toEqual(DEFAULT_CONVENTIONS);
  });

  it('should keep the value and default the rest when the file gives only one', () => {
    const parsed = conventionsSchema.parse({ turnName: 'my-turn' });

    expect(parsed.turnName).toBe('my-turn');
    expect(parsed.ratingScore).toBe('feedback_helpful');
  });
});

describe('conventionsSchema validation', () => {
  it.each([
    ['turnName', ''],
    ['turnName', '   '],
    ['turnName', 'two\nlines'],
    ['turnName', 'x'.repeat(101)],
    ['ratingScore', 'a,b'],
    ['ratingScore', 'bell\u0007'],
    ['reasonScorePrefix', 'a,b'],
    ['passLabel', ''],
    ['passLabel', 'x'.repeat(21)],
    ['assistantName', 'esc\u001b[2J'],
  ])('should refuse the setting when %s = %j', (name, value) => {
    expect(conventionsSchema.safeParse({ [name]: value }).success).toBe(false);
  });

  it('should accept the prefix when it is empty, because some projects name reasons directly', () => {
    expect(conventionsSchema.safeParse({ reasonScorePrefix: '' }).success).toBe(true);
  });

  it('should refuse the reason and say which one when it is listed twice', () => {
    const result = conventionsSchema.safeParse({ reasons: ['a', 'b', 'a'] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('"a" is listed twice');
  });

  it('should refuse the list when the yes values are empty', () => {
    expect(conventionsSchema.safeParse({ yesValues: [] }).success).toBe(false);
  });

  it('should refuse the setting when the schema does not know it', () => {
    expect(conventionsSchema.safeParse({ turnNmae: 'x' }).success).toBe(false);
  });

  it('should refuse the reason when it has a comma, because it would split in the score query', () => {
    expect(conventionsSchema.safeParse({ reasons: ['a,b'] }).success).toBe(false);
  });
});

describe('configFileSchema strictness', () => {
  it('should refuse the key when it is unknown at the top of the file', () => {
    const result = configFileSchema.safeParse({ ...DEFAULT_CONFIG, mystery: 1 });

    expect(result.success).toBe(false);
  });

  it('should refuse the key when it is unknown inside a profile', () => {
    const result = configFileSchema.safeParse({
      activeProfile: 'dev',
      profiles: { dev: { baseUrl: 'https://x.test', typo: true } },
    });

    expect(result.success).toBe(false);
  });
});

describe('configFileSchema profiles', () => {
  it('should refuse the file when its active profile is not one of the profiles', () => {
    const result = configFileSchema.safeParse({
      activeProfile: 'prod',
      profiles: { dev: { baseUrl: 'https://x.test' } },
    });

    expect(result.error?.issues[0]?.message).toBe('"prod" is not one of the profiles: dev');
  });

  it('should refuse the file when it has no profiles at all', () => {
    const result = configFileSchema.safeParse({ activeProfile: 'dev', profiles: {} });

    expect(result.error?.issues[0]?.message).toBe('needs at least one profile');
  });

  it('should refuse the active profile when it is only an inherited object property', () => {
    const result = configFileSchema.safeParse({
      activeProfile: 'toString',
      profiles: { dev: { baseUrl: 'https://x.test' } },
    });

    expect(result.error?.issues[0]?.message).toBe('"toString" is not one of the profiles: dev');
  });

  it('should accept the file when its active profile exists', () => {
    expect(
      configFileSchema.safeParse({
        activeProfile: 'dev',
        profiles: { dev: { baseUrl: 'https://x.test' } },
      }).success,
    ).toBe(true);
  });
});

describe('settable keys', () => {
  it('should describe every settable key when the settings are listed', () => {
    expect(Object.keys(SETTING_DESCRIPTIONS).sort()).toEqual([...SETTABLE_KEYS].sort());
  });

  it('should offer a conventions key when a convention exists', () => {
    const names = Object.keys(DEFAULT_CONVENTIONS).map((name) => `conventions.${name}`);

    expect(names.every((name) => (SETTABLE_KEYS as readonly string[]).includes(name))).toBe(true);
  });
});
