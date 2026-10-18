import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { settingRows } from './config-report.js';
import { DEFAULT_CONFIG, type ConfigFile } from './config-schema.js';
import {
  checkConfigFile,
  loadConfigFile,
  saveConfigFile,
  setConfigValue,
  unsetConfigValue,
} from './config-store.js';

describe('setConfigValue for conventions', () => {
  it('should set the turn name when the setting is changed', () => {
    expect(
      setConfigValue(DEFAULT_CONFIG, 'conventions.turnName', 'my-turn').conventions.turnName,
    ).toBe('my-turn');
  });

  it('should split the list on commas and trim each item when a list is set', () => {
    const next = setConfigValue(DEFAULT_CONFIG, 'conventions.reasons', ' wrong ,slow,  rude ');

    expect(next.conventions.reasons).toEqual(['wrong', 'slow', 'rude']);
  });

  it('should drop the empty items when a list is set', () => {
    const next = setConfigValue(DEFAULT_CONFIG, 'conventions.yesValues', 'yes,, 1 ,');

    expect(next.conventions.yesValues).toEqual(['yes', '1']);
  });

  it('should refuse the list and say which position when an item is repeated', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'conventions.reasons', 'a,b,a')).toThrow(
      'Invalid value for conventions.reasons: [3]: "a" is listed twice',
    );
  });

  it('should not repeat the key in the message when a single value is wrong', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'conventions.passLabel', ' ')).toThrow(
      'Invalid value for conventions.passLabel: must not be empty',
    );
  });

  it('should refuse the turn name and name the key when it is empty', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'conventions.turnName', '  ')).toThrow(
      'conventions.turnName',
    );
  });

  it('should refuse the score name when it has a comma', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'conventions.ratingScore', 'a,b')).toThrow(
      'must not contain a comma',
    );
  });

  it('should leave the other conventions alone when one is set', () => {
    const next = setConfigValue(DEFAULT_CONFIG, 'conventions.passLabel', 'Good');

    expect(next.conventions.failLabel).toBe('Fail');
  });
});

describe('unsetConfigValue', () => {
  it('should put the convention back to its default when it is unset', () => {
    const changed = setConfigValue(DEFAULT_CONFIG, 'conventions.turnName', 'my-turn');

    expect(unsetConfigValue(changed, 'conventions.turnName').conventions.turnName).toBe(
      'chat-turn',
    );
  });

  it('should put the list back to its default when it is unset', () => {
    const changed = setConfigValue(DEFAULT_CONFIG, 'conventions.reasons', 'a,b');

    expect(unsetConfigValue(changed, 'conventions.reasons').conventions.reasons).toHaveLength(12);
  });

  it('should reset profile.baseUrl to the default when it is unset', () => {
    const changed = setConfigValue(DEFAULT_CONFIG, 'profile.baseUrl', 'https://eu.example.com');

    expect(unsetConfigValue(changed, 'profile.baseUrl').profiles.dev?.baseUrl).toBe(
      'https://cloud.langfuse.com',
    );
  });
});

describe('settingRows', () => {
  it('should show every setting with its current value and what it means when the config is shown', () => {
    const rows = settingRows(setConfigValue(DEFAULT_CONFIG, 'conventions.turnName', 'my-turn'));

    const turn = rows.find(([key]) => key === 'conventions.turnName');
    expect(turn?.[1]).toContain('my-turn');
    expect(turn?.[1]).toContain('observation');
  });

  it('should show the list on one line with commas when the config is shown', () => {
    const rows = settingRows(setConfigValue(DEFAULT_CONFIG, 'conventions.reasons', 'a,b'));

    expect(rows.find(([key]) => key === 'conventions.reasons')?.[1]).toContain('a, b');
  });

  it('should say the setting is not set when it has no value', () => {
    expect(settingRows(DEFAULT_CONFIG).find(([key]) => key === 'llm.model')?.[1]).toContain(
      '(not set)',
    );
  });
});

describe('settingRows for a --profile override', () => {
  const TWO: ConfigFile = {
    ...DEFAULT_CONFIG,
    profiles: {
      dev: { baseUrl: 'https://dev.example.com', envFile: '/keys/dev.env' },
      prod: { baseUrl: 'https://prod.example.com', envFile: '/keys/prod.env' },
    },
  };

  it('should show the active profile when no override is given', () => {
    const rows = settingRows(TWO);

    expect(rows.find(([key]) => key === 'profile.baseUrl')?.[1]).toContain('dev.example.com');
  });

  it('should show the profile the run uses when an override is given', () => {
    const rows = settingRows(TWO, 'prod');

    expect(rows.find(([key]) => key === 'profile.baseUrl')?.[1]).toContain('prod.example.com');
    expect(rows.find(([key]) => key === 'profile.envFile')?.[1]).toContain('/keys/prod.env');
  });
});

describe('config file on disk', () => {
  const fresh = (): string => join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.json');

  it('should write the defaults with every convention when a new file is created', async () => {
    const path = fresh();

    await saveConfigFile(path, DEFAULT_CONFIG);

    const written = JSON.parse(readFileSync(path, 'utf8')) as { conventions: { turnName: string } };
    expect(written.conventions.turnName).toBe('chat-turn');
  });

  it('should leave no side file behind when the file is saved', async () => {
    const path = fresh();

    await saveConfigFile(path, DEFAULT_CONFIG);

    expect(readdirSync(dirname(path))).toEqual(['config.json']);
  });

  it('should replace the file by rename so a reader never meets a half-written file', async () => {
    const path = fresh();
    await saveConfigFile(path, DEFAULT_CONFIG);
    const before = statSync(path).ino;

    await saveConfigFile(path, setConfigValue(DEFAULT_CONFIG, 'conventions.turnName', 'second'));

    expect(statSync(path).ino).not.toBe(before);
  });

  it('should keep the old file and leave no side file when the new content is refused', async () => {
    const path = fresh();
    await saveConfigFile(path, DEFAULT_CONFIG);
    const broken = { ...DEFAULT_CONFIG, activeProfile: '' } as ConfigFile;

    await expect(saveConfigFile(path, broken)).rejects.toThrow();

    expect([readdirSync(dirname(path)), readFileSync(path, 'utf8').includes('"dev"')]).toEqual([
      ['config.json'],
      true,
    ]);
  });

  it('should read back what it wrote when the file is loaded', async () => {
    const path = fresh();
    await saveConfigFile(path, setConfigValue(DEFAULT_CONFIG, 'conventions.turnName', 'my-turn'));

    expect((await loadConfigFile(path)).conventions.turnName).toBe('my-turn');
  });

  it('should fill in what is left out when a hand-edited file is loaded', async () => {
    const path = fresh();
    writeFileSync(
      path,
      JSON.stringify({
        activeProfile: 'dev',
        profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
        conventions: { turnName: 'edited' },
      }),
    );

    const file = await loadConfigFile(path);

    expect(file.conventions.turnName).toBe('edited');
    expect(file.conventions.ratingScore).toBe('feedback_helpful');
  });

  it('should refuse the file and list the problem with its path when a value is wrong', async () => {
    const path = fresh();
    writeFileSync(
      path,
      JSON.stringify({
        activeProfile: 'dev',
        profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
        conventions: { turnName: '' },
      }),
    );

    await expect(loadConfigFile(path)).rejects.toThrow('conventions.turnName: must not be empty');
  });

  it('should tell the user how to check the file when it cannot be loaded', async () => {
    const path = fresh();
    writeFileSync(path, '{ broken');

    await expect(loadConfigFile(path)).rejects.toThrow('jeves config check');
  });

  it('should treat a missing file as the defaults and say it is missing when checked', async () => {
    const path = fresh();

    expect(await loadConfigFile(path)).toEqual(DEFAULT_CONFIG);
    expect((await checkConfigFile(path)).missing).toBe(true);
  });
});
