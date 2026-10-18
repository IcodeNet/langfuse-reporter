import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { brand } from '../brand/brand.js';
import { packagePath } from '../package-root.js';
import { limitConcurrency } from '../ui-server/limit-concurrency.js';
import { startUiServer, type CliRunner } from '../ui-server/ui-server.js';
import type { AppContext } from './app-context.js';

/** The built setup page, shipped inside the package. */
const PAGE_DIR = packagePath('dist-ui');

/** How many commands the page may run at once, and how many more may wait; the rest are refused. */
const MAX_RUNNING_COMMANDS = 4;
const MAX_WAITING_COMMANDS = 16;

/** Runs this same program again with the user's config and profile, so every request meets the CLI's own rules. */
export function cliRunnerFor(
  app: Pick<AppContext, 'configPath' | 'profileOverride' | 'demo'>,
): CliRunner {
  const global = [
    '--config',
    app.configPath,
    ...(app.profileOverride ? ['--profile', app.profileOverride] : []),
    ...(app.demo ? ['--demo'] : []),
  ];
  return limitConcurrency(
    (args: string[]) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [...process.execArgv, process.argv[1] ?? '', ...global, ...args],
          {
            env: { ...process.env, NO_COLOR: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      }),
    { running: MAX_RUNNING_COMMANDS, waiting: MAX_WAITING_COMMANDS },
  );
}

function openInBrowser(url: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(opener, args, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
}

export interface UiOptions {
  open: boolean;
  pageDir?: string;
  /** True in a shell: block until Ctrl+C. False in the session: keep running until the session ends. */
  wait: boolean;
}

/** Starts the local setup page and waits until the user presses Ctrl+C. */
export async function runUi(
  app: Pick<AppContext, 'reporter' | 'configPath' | 'profileOverride' | 'demo'>,
  options: UiOptions,
): Promise<void> {
  const pageDir = options.pageDir ?? PAGE_DIR;
  if (!existsSync(pageDir)) {
    app.reporter.warn(
      `The setup page is not built yet (${pageDir} is missing). Run: pnpm build:ui`,
    );
    process.exitCode = 1;
    return;
  }
  const server = await startUiServer({ staticDir: pageDir, runCli: cliRunnerFor(app) });
  app.reporter.done(`${brand.name} setup is running. Open this address in your browser:`);
  process.stdout.write(`${server.url}\n`);
  app.reporter.note(
    options.wait
      ? 'It answers only on this computer, and only with this link. Press Ctrl+C to stop.'
      : 'It answers only on this computer, and only with this link. It stops when you leave the session.',
  );
  if (options.open) openInBrowser(server.url);
  if (!options.wait) return;
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await server.close();
  app.reporter.done('Setup stopped.');
}
