import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type ConfigFile } from './config-schema.js';
import { envFileWarning, newEnvFileWarning } from './path-warnings.js';

function withEnvFile(envFile: string | undefined): ConfigFile {
  return {
    ...DEFAULT_CONFIG,
    profiles: { dev: { baseUrl: 'https://cloud.langfuse.com', envFile } },
  };
}

describe('envFileWarning', () => {
  it('should say nothing when no env file is set', () => {
    expect(envFileWarning(withEnvFile(undefined), 'dev')).toBeUndefined();
  });

  it('should say nothing when the env file exists', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pw-')), 'dev.env');
    writeFileSync(file, 'X=1');

    expect(envFileWarning(withEnvFile(file), 'dev')).toBeUndefined();
  });

  it('should name the missing file and the command that fixes it when it does not exist', () => {
    const warning = envFileWarning(withEnvFile('/nonexistent/dev.env'), 'dev');

    expect(warning).toContain('/nonexistent/dev.env does not exist yet');
    expect(warning).toContain('config set profile.envFile <file>');
  });

  it('should say it is a folder when the path is a folder', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pw-'));

    expect(envFileWarning(withEnvFile(folder), 'dev')).toContain('is a folder, not a file');
  });
});

describe('newEnvFileWarning', () => {
  it('should stay quiet when the env file was already missing before the change', () => {
    const before = withEnvFile('/nonexistent/dev.env');
    const after = { ...before, outDir: '/tmp/out' };

    expect(newEnvFileWarning(before, after, 'dev')).toBeUndefined();
  });

  it('should warn when the change is what pointed the profile at a missing file', () => {
    const before = withEnvFile(undefined);
    const after = withEnvFile('/nonexistent/dev.env');

    expect(newEnvFileWarning(before, after, 'dev')).toContain('does not exist yet');
  });
});
