import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configFileSchema,
  conventionsSchema,
  DEFAULT_CONFIG,
  profileSchema,
} from './config-schema.js';
import { setConfigValue, unsetConfigValue, useProfile } from './config-store.js';
import { formatConfig } from './format-config.js';
import { lastMonthWindow, resolveConfig, withEnvironmentAddress } from './resolve-config.js';

describe('lastMonthWindow', () => {
  it('should return the whole previous calendar month when run mid-month', () => {
    expect(lastMonthWindow(new Date('2026-10-12T10:00:00Z'))).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
  });

  it('should roll back into the previous year when run in January', () => {
    expect(lastMonthWindow(new Date('2026-01-05T00:00:00Z'))).toEqual({
      from: '2025-12-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('setConfigValue', () => {
  it('should update the active profile when a profile key is set', () => {
    const next = setConfigValue(DEFAULT_CONFIG, 'profile.baseUrl', 'https://eu.cloud.langfuse.com');

    expect(next.profiles.dev?.baseUrl).toBe('https://eu.cloud.langfuse.com');
  });

  it('should list the valid keys when the key is unknown', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'profile.secretKey', 'x')).toThrow(
      'Valid keys: outDir, profile.baseUrl',
    );
  });

  it('should reject the provider when it is not a supported LLM provider', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'llm.provider', 'bard')).toThrow('llm.provider');
  });

  it('should save the LLM provider and model on their own when set one at a time', () => {
    const withProvider = setConfigValue(DEFAULT_CONFIG, 'llm.provider', 'litellm');
    const withModel = setConfigValue(withProvider, 'llm.model', 'claude-sonnet-5');

    expect(withModel.llm).toEqual({ provider: 'litellm', model: 'claude-sonnet-5' });
  });

  it('should reject the base URL when it is not a URL', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'profile.baseUrl', 'langfuse')).toThrow('baseUrl');
  });
});

describe('unsetConfigValue', () => {
  it('should remove only that LLM setting when one is unset', () => {
    const configured = setConfigValue(
      setConfigValue(DEFAULT_CONFIG, 'llm.provider', 'openai'),
      'llm.model',
      'gpt-x',
    );

    expect(unsetConfigValue(configured, 'llm.model').llm).toEqual({ provider: 'openai' });
  });

  it('should remove the optional field when a profile key is unset', () => {
    const changed = setConfigValue(DEFAULT_CONFIG, 'profile.envFile', '/tmp/a.env');

    expect(unsetConfigValue(changed, 'profile.envFile').profiles.dev?.envFile).toBeUndefined();
  });
});

describe('useProfile', () => {
  it('should create and activate a profile when a base URL is given', () => {
    const next = useProfile(DEFAULT_CONFIG, 'prod', 'https://prod.example.com');

    expect(next.activeProfile).toBe('prod');
    expect(next.profiles.prod?.baseUrl).toBe('https://prod.example.com');
  });

  it('should refuse to create a profile when no base URL is given', () => {
    expect(() => useProfile(DEFAULT_CONFIG, 'prod')).toThrow('config use prod --base-url');
  });
});

describe('resolveConfig with an unreadable env file', () => {
  const missing = {
    ...DEFAULT_CONFIG,
    profiles: { dev: { baseUrl: 'https://x.test', envFile: '/nonexistent/dev.env' } },
  };

  it('should not throw when the env file cannot be read, so commands that need no keys keep working', () => {
    expect(() => resolveConfig(missing, {})).not.toThrow();
  });

  it('should record why the file could not be read when it is missing', () => {
    expect(resolveConfig(missing, {}).envFileProblem).toBe(
      'Cannot read the env file /nonexistent/dev.env: ENOENT. Save a full path with: jeves config set profile.envFile <absolute-path>',
    );
  });

  it('should say where the file was looked for when a relative env file is missing', () => {
    const relative = {
      ...DEFAULT_CONFIG,
      profiles: { dev: { baseUrl: 'https://x.test', envFile: 'no-such-folder/dev.env' } },
    };

    expect(resolveConfig(relative, {}).envFileProblem).toContain(
      `no-such-folder/dev.env (looked in ${join(process.cwd(), 'no-such-folder/dev.env')})`,
    );
  });

  it('should leave the Langfuse keys unset when the env file cannot be read', () => {
    expect([resolveConfig(missing, {}).publicKey, resolveConfig(missing, {}).secretKey]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('should show the problem beside the env file when the config is displayed', () => {
    expect(formatConfig(resolveConfig(missing, {}), '/c.json')).toContain(
      '/nonexistent/dev.env  ✗ cannot be read',
    );
  });
});

describe('resolveConfig', () => {
  it('should use the flag when a per-run flag overrides the saved output folder', () => {
    const resolved = resolveConfig(DEFAULT_CONFIG, { outDir: '/tmp/elsewhere' });

    expect(resolved.outDir).toBe('/tmp/elsewhere');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-04-31', '2026-00-10'])(
    'should refuse the impossible date %s when it is given as a window boundary',
    (value) => {
      expect(() => resolveConfig(DEFAULT_CONFIG, { from: value })).toThrow('is not a real date');
    },
  );

  it('should refuse a timestamp with no zone when it is given as a window boundary', () => {
    expect(() => resolveConfig(DEFAULT_CONFIG, { from: '2026-09-01T10:00:00' })).toThrow(
      'is not a real date',
    );
  });

  it('should accept 29 February in a leap year when it is given as a window boundary', () => {
    const resolved = resolveConfig(DEFAULT_CONFIG, { from: '2028-02-29', to: '2028-03-02' });

    expect(resolved.from).toBe('2028-02-29T00:00:00.000Z');
  });

  it('should fail with the known profile names when the profile is missing', () => {
    expect(() => resolveConfig(DEFAULT_CONFIG, { profile: 'prod' })).toThrow('Existing: dev');
  });
});

describe('formatConfig', () => {
  it('should mask the public key and never print the secret when keys are set', () => {
    const resolved = {
      ...resolveConfig(DEFAULT_CONFIG, {}, new Date('2026-10-12T00:00:00Z')),
      publicKey: 'pk-lf-abcdef1234567890',
      secretKey: 'sk-lf-topsecretvalue',
    };

    const banner = formatConfig(resolved, '/tmp/config.json');

    expect(banner).toContain('pk-lf-a…**** (22 chars)');
    expect(banner).not.toContain('topsecretvalue');
  });
});

describe('resolveConfig relative dates', () => {
  const now = new Date('2026-10-14T15:30:00.000Z');

  it('should read today as the start of the day for --from and the end of the day for --to when today is given', () => {
    const resolved = resolveConfig(DEFAULT_CONFIG, { from: 'today', to: 'today' }, now);

    expect([resolved.from, resolved.to]).toEqual([
      '2026-10-14T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
    ]);
  });

  it('should count days back and include today when --from -7d and --to today are given', () => {
    const resolved = resolveConfig(DEFAULT_CONFIG, { from: '-7d', to: 'today' }, now);

    expect([resolved.from, resolved.to]).toEqual([
      '2026-10-07T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
    ]);
  });

  it('should accept the date when --from and --to are calendar dates', () => {
    const resolved = resolveConfig(DEFAULT_CONFIG, { from: '2026-10-01', to: '2026-10-13' }, now);

    expect([resolved.from, resolved.to]).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-10-13T00:00:00.000Z',
    ]);
  });

  it('should list the relative words in the message when a date is not real', () => {
    expect(() => resolveConfig(DEFAULT_CONFIG, { from: 'someday' }, now)).toThrow(
      '--from "someday" is not a real date. Use 2026-09-01, 2026-09-01T10:00:00Z, today, yesterday or -7d',
    );
  });
});

describe('web addresses in the config', () => {
  it.each([
    [
      'https://user:secret@cloud.example.com',
      'must not contain a user name or password; keys belong in the env file',
    ],
    [
      'https://token@cloud.example.com',
      'must not contain a user name or password; keys belong in the env file',
    ],
    ['ftp://files.example.com', 'must start with http:// or https://'],
    ['mailto:a@b.c', 'must start with http:// or https://'],
    ['not a url', 'Invalid URL'],
  ])('should refuse the Langfuse address with a reason when it is %s', (baseUrl, reason) => {
    const result = profileSchema.safeParse({ baseUrl });

    expect(result.error?.issues[0]?.message).toBe(reason);
  });

  it('should accept the address when it is a plain https address with a port and a path', () => {
    expect(
      profileSchema.safeParse({ baseUrl: 'https://langfuse.example.com:3000/base' }).success,
    ).toBe(true);
  });

  it('should refuse the address when a model gateway address carries a password', () => {
    const result = configFileSchema.safeParse({
      ...DEFAULT_CONFIG,
      llm: { baseUrl: 'https://u:secret@gateway.example.com' },
    });

    expect(result.success).toBe(false);
  });
});

describe('profile names that are also object property names', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'should say the profile %s does not exist when it was never created',
    (name) => {
      expect(() => resolveConfig(DEFAULT_CONFIG, { profile: name })).toThrow('does not exist');
    },
  );

  it('should not switch to an inherited name when using a profile', () => {
    expect(() => useProfile(DEFAULT_CONFIG, 'toString')).toThrow('does not exist');
  });
});

describe('withEnvironmentAddress', () => {
  const profile = { baseUrl: 'https://cloud.langfuse.com' };

  it('should keep the profile address when the environment sets none', () => {
    expect(withEnvironmentAddress(profile, {})).toEqual(profile);
  });

  it('should use the environment address when LANGFUSE_BASE_URL is set', () => {
    expect(
      withEnvironmentAddress(profile, { LANGFUSE_BASE_URL: 'http://localhost:3000' }).baseUrl,
    ).toBe('http://localhost:3000');
  });

  it('should drop surrounding quotes when the value comes from a dotenv style line', () => {
    expect(
      withEnvironmentAddress(profile, { LANGFUSE_BASE_URL: '"https://us.cloud.langfuse.com"' })
        .baseUrl,
    ).toBe('https://us.cloud.langfuse.com');
  });

  it('should keep the env file path of the profile when the address is replaced', () => {
    expect(
      withEnvironmentAddress(
        { ...profile, envFile: '/keys.env' },
        { LANGFUSE_BASE_URL: 'http://localhost:3000' },
      ),
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      envFile: '/keys.env',
    });
  });

  it('should ignore an empty value and a value of only spaces', () => {
    expect([
      withEnvironmentAddress(profile, { LANGFUSE_BASE_URL: '' }),
      withEnvironmentAddress(profile, { LANGFUSE_BASE_URL: '   ' }),
    ]).toEqual([profile, profile]);
  });

  it('should leave the demo address alone so sample data never goes to a real server', () => {
    const demo = { baseUrl: 'https://demo.invalid' };

    expect(
      withEnvironmentAddress(demo, { LANGFUSE_BASE_URL: 'https://cloud.langfuse.com' }),
    ).toEqual(demo);
  });

  it.each([
    ['not a url', 'Invalid URL'],
    ['ftp://example.com', 'must start with http:// or https://'],
    ['http://user:pass@host:3000', 'must not contain a user name or password'],
  ])('should refuse %s and say why', (value, reason) => {
    expect(() => withEnvironmentAddress(profile, { LANGFUSE_BASE_URL: value })).toThrow(reason);
  });

  it('should not repeat the http hint when the reason already names it', () => {
    expect(() => withEnvironmentAddress(profile, { LANGFUSE_BASE_URL: 'ftp://x' })).toThrow(
      /^LANGFUSE_BASE_URL is not a usable address \(must start with http:\/\/ or https:\/\/\)\.$/,
    );
  });
});

describe('conventions.riskAreas', () => {
  it('should default to the five built-in reason to area pairs when the file does not name any', () => {
    expect(conventionsSchema.parse({}).riskAreas).toEqual([
      'wrong_answer=factuality',
      'incomplete_answer=response-quality',
      'off_topic=relevance',
      'hard_to_follow=tone-of-voice',
      'harmful_content=content-safety',
    ]);
  });

  it('should accept a pair whose area the dashboard knows', () => {
    expect(conventionsSchema.parse({ riskAreas: ['other_issue=pii'] }).riskAreas).toEqual([
      'other_issue=pii',
    ]);
  });

  it.each(['other_issue=nonsense', 'other_issue', '=pii', 'a=b=c'])(
    'should refuse %j because it is not a reason=area pair with a known area',
    (entry) => {
      expect(() => conventionsSchema.parse({ riskAreas: [entry] })).toThrow();
    },
  );
});

describe('config set conventions.riskAreas', () => {
  it('should store the pairs as a list when the value is comma separated', () => {
    const next = setConfigValue(
      DEFAULT_CONFIG,
      'conventions.riskAreas',
      'wrong_answer=compliance,other_issue=pii',
    );

    expect(next.conventions.riskAreas).toEqual(['wrong_answer=compliance', 'other_issue=pii']);
  });

  it('should refuse the value and keep the old map when an area is unknown', () => {
    expect(() =>
      setConfigValue(DEFAULT_CONFIG, 'conventions.riskAreas', 'wrong_answer=nonsense'),
    ).toThrow(/area is one of/);
  });
});
