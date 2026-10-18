import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkConfigText,
  setConfigValue,
  useProfile,
  withoutSurroundingQuotes,
} from './config-store.js';
import { DEFAULT_CONFIG, SETTABLE_KEYS } from './config-schema.js';

const REFERENCE = readFileSync(new URL('../../docs/config.json.local', import.meta.url), 'utf8');

describe('checkConfigText with comments', () => {
  it('should accept the config when it has // and block comments', () => {
    const text =
      '{\n  // which profile\n  "activeProfile": "dev", /* note */\n  "profiles": { "dev": { "baseUrl": "https://x.test" } }\n}';

    expect(checkConfigText(text).problems).toEqual([]);
  });

  it('should still report invalid JSON when a comment is not the cause', () => {
    expect(checkConfigText('{ // c\n "a": }').problems[0]).toContain('not valid JSON');
  });
});

describe('the shipped reference config docs/config.json.local', () => {
  it('should pass the same check as any user config when the default config is checked', () => {
    expect(checkConfigText(REFERENCE).problems).toEqual([]);
  });

  it.each(SETTABLE_KEYS.map((key) => key.split('.').at(-1) ?? key))(
    'should mention the setting %s',
    (name) => {
      expect(REFERENCE).toContain(name);
    },
  );
});

describe('setConfigValue for the env file', () => {
  it('should save an absolute path when the env file is given as a relative one', () => {
    const next = setConfigValue(DEFAULT_CONFIG, 'profile.envFile', 'keys/prod.env');

    expect(next.profiles.dev?.envFile).toBe(join(process.cwd(), 'keys/prod.env'));
  });

  it('should keep the path as it is when the env file is absolute', () => {
    const next = setConfigValue(DEFAULT_CONFIG, 'profile.envFile', '/etc/keys/prod.env');

    expect(next.profiles.dev?.envFile).toBe('/etc/keys/prod.env');
  });
});

describe('setConfigValue path and empty-value rules', () => {
  const base = DEFAULT_CONFIG;

  it('should refuse an empty value and name the example and the unset command when set is given nothing', () => {
    expect(() => setConfigValue(base, 'profile.envFile', '')).toThrow(
      'profile.envFile needs a value. Example: config set profile.envFile ~/.langfuse-dev.env. To go back to the default use: config unset profile.envFile',
    );
  });

  it('should refuse the value when outDir is only spaces', () => {
    expect(() => setConfigValue(base, 'outDir', '   ')).toThrow('outDir needs a value');
  });

  it('should refuse the value when outDir is only a pair of quotes', () => {
    expect(() => setConfigValue(base, 'outDir', '""')).toThrow('outDir needs a value');
  });

  it('should store the folder without the quotes when outDir is typed in quotes', () => {
    const next = setConfigValue(base, 'outDir', '"/tmp/my reports"');

    expect(next.outDir).toBe('/tmp/my reports');
  });

  it('should store the text without the quotes when a convention is typed in single quotes', () => {
    const next = setConfigValue(base, 'conventions.turnName', "'my-turn'");

    expect(next.conventions.turnName).toBe('my-turn');
  });

  it('should store a relative outDir as a full path when it is set', () => {
    const next = setConfigValue(base, 'outDir', 'relative/dir');

    expect(next.outDir).toBe(resolve('relative/dir'));
  });

  it('should expand a leading ~ in outDir and envFile when the shell did not', () => {
    const next = setConfigValue(
      setConfigValue(base, 'outDir', '~/feedback'),
      'profile.envFile',
      '~/.dev.env',
    );

    expect([next.outDir, next.profiles.dev?.envFile]).toEqual([
      join(homedir(), 'feedback'),
      join(homedir(), '.dev.env'),
    ]);
  });

  it('should say the address is not a web address when a new profile gets a bad base url', () => {
    expect(() => useProfile(base, 'qa', 'notaurl')).toThrow(
      '"notaurl" is not a web address. Use the full address, for example: --base-url https://cloud.langfuse.com',
    );
  });

  it('should list the existing profiles and both ways forward when the profile is unknown', () => {
    expect(() => useProfile(base, 'qa')).toThrow(
      'Profile "qa" does not exist. Existing: dev. Switch with: config use <name>. Create it with: config use qa --base-url <url>',
    );
  });
});

describe('withoutSurroundingQuotes', () => {
  it.each([
    ['"a b"', 'a b'],
    ["'a b'", 'a b'],
    ['""', ''],
    ['"a', '"a'],
    ['a"', 'a"'],
    ['"a\'', '"a\''],
    ["it's", "it's"],
    ['plain', 'plain'],
    ['"', '"'],
  ])('should turn %j into %j when it is checked for surrounding quotes', (typed, expected) => {
    expect(withoutSurroundingQuotes(typed)).toBe(expected);
  });
});
