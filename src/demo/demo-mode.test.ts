import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/app-context.js';
import { loadDataset } from '../app/load-dataset.js';
import { runAnalyse } from '../app/run-analyse.js';
import { runExport } from '../app/run-export.js';
import { resolveConfig } from '../config/resolve-config.js';
import { runSavedQuery } from '../queries/run-query.js';
import { createReporter } from '../ui/reporter.js';
import { demoConfig } from './demo-config.js';
import { DEMO_BASE_URL } from './demo-constants.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const REPORTER = createReporter({ stream: { write: () => true }, interactive: false });

function resolveDemo(outDir: string) {
  return resolveConfig(demoConfig(), { outDir }, NOW);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('demo mode', () => {
  it('should use fixed demo keys and read no env file when the demo profile is resolved', () => {
    const resolved = resolveDemo('/tmp/x');

    expect([resolved.profile.baseUrl, resolved.publicKey, resolved.envFileProblem]).toEqual([
      DEMO_BASE_URL,
      'demo-public-key',
      undefined,
    ]);
  });

  it('should load 60 ratings from the sample data when the dataset is loaded', async () => {
    const dataset = await loadDataset(resolveDemo('/tmp/x'), REPORTER);

    expect(dataset.rows).toHaveLength(60);
  });

  it('should write masked files only when the sample data is exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-'));
    const resolved = resolveDemo(dir);
    const dataset = await loadDataset(resolved, REPORTER);

    await runExport({ dataset, resolved, reporter: REPORTER, format: 'json' });

    const text = readdirSync(dir)
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('\n');
    expect(/@example\.com|07700|4111/.test(text)).toBe(false);
  });

  it('should group the sample ratings without calling a model when analyse runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-'));
    const resolved = resolveDemo(dir);
    const dataset = await loadDataset(resolved, REPORTER);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const written = await runAnalyse({ dataset, resolved, reporter: REPORTER, yes: true });

    expect([fetchSpy.mock.calls.length, written !== undefined]).toEqual([0, true]);
    fetchSpy.mockRestore();
  });

  it('should pass one sample query and fail the other when the saved queries run', async () => {
    const config = demoConfig();
    const run = (name: string) =>
      runSavedQuery({ name, config, profileOverride: undefined, reporter: REPORTER, now: NOW });

    const exits = [(await run('weekly-health')).exit, (await run('no-harm')).exit];

    expect(exits).toEqual([0, 1]);
  });

  it('should send no request to the network when a demo dataset is loaded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await loadDataset(resolveDemo('/tmp/x'), REPORTER);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('createAppContext demo flag', () => {
  it('should default to not demo when no flag is given', () => {
    expect(createAppContext('/tmp/c.json', undefined).demo).toBe(false);
  });

  it('should be demo when the flag is given', () => {
    expect(createAppContext('/tmp/c.json', undefined, {}, true).demo).toBe(true);
  });

  it('should not create the config file when a demo app context is made', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'demo-')), 'c.json');

    createAppContext(path, undefined, {}, true);

    expect(existsSync(path)).toBe(false);
  });
});
