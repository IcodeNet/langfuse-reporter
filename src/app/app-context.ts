import { CLI_VERSION } from './cli-version.js';
import { loadConfigFile, listProfilesSync } from '../config/config-store.js';
import { demoConfig } from '../demo/demo-config.js';
import { DEMO_NOTICE } from '../demo/demo-constants.js';
import { configRows } from '../config/format-config.js';
import type { ConfigFile } from '../config/config-schema.js';
import { resolveConfig, type ResolvedConfig, type RunOverrides } from '../config/resolve-config.js';
import { renderBanner, type BannerInfo } from '../ui/banner.js';
import { createReporter, type Reporter } from '../ui/reporter.js';

/** Used when the terminal reports no width (0 or missing), as a pipe or a bare pseudo-terminal does. */
const DEFAULT_COLUMNS = 80;

export interface AppContext {
  configPath: string;
  profileOverride: string | undefined;
  reporter: Reporter;
  /** True on a real terminal: spinner, screen clearing and the full banner. */
  interactive: boolean;
  /** Colour is on only for a terminal where `NO_COLOR` is not set. */
  color: boolean;
  columns: number;
  /** Dates given with --from/--to; the session starts on this window. */
  window: { from?: string; to?: string };
  /** True with --demo: the built-in config and sample data are used and the config file is never read or written. */
  demo: boolean;
}

export function createAppContext(
  configPath: string,
  profileOverride: string | undefined,
  window: AppContext['window'] = {},
  demo = false,
): AppContext {
  const interactive = process.stderr.isTTY;
  const color = interactive && process.env.NO_COLOR === undefined;
  return {
    configPath,
    profileOverride,
    window,
    demo,
    interactive,
    color,
    columns: process.stderr.columns || DEFAULT_COLUMNS,
    reporter: createReporter({
      stream: process.stderr,
      interactive,
      color,
      columns: process.stderr.columns || DEFAULT_COLUMNS,
    }),
  };
}

/** Stops a command that would change the config file when the run is a demo, so a demo can never touch real settings. */
export function refuseInDemo(app: AppContext, what: string): boolean {
  if (!app.demo) return false;
  app.reporter.warn(`${what} works with the config file, so it is not available with --demo.`);
  process.exitCode = 2;
  return true;
}

/** The config for this run: the built-in one in demo mode, otherwise the file. */
export async function loadAppConfig(app: AppContext): Promise<ConfigFile> {
  return app.demo ? demoConfig() : loadConfigFile(app.configPath);
}

export async function resolveRun(
  app: AppContext,
  overrides: RunOverrides = {},
): Promise<ResolvedConfig> {
  const file = await loadAppConfig(app);
  return resolveConfig(file, { profile: app.profileOverride, ...overrides });
}

/** Prints the Jeves banner and the resolved config. Every command calls this first. */
export function printBanner(
  app: AppContext,
  resolved: ResolvedConfig,
  commands: BannerInfo['commands'] = [],
): void {
  const { activeProfile, profiles } = app.demo
    ? {
        activeProfile: resolved.profileName,
        profiles: [{ name: resolved.profileName, baseUrl: resolved.profile.baseUrl }],
      }
    : listProfilesSync(app.configPath);
  const info: BannerInfo = {
    version: CLI_VERSION,
    configRows: app.demo
      ? [['mode', DEMO_NOTICE], ...configRows(resolved, 'none (built-in demo config)').slice(1)]
      : configRows(resolved, app.configPath),
    profiles: profiles.map((profile) => ({
      ...profile,
      active: profile.name === (app.profileOverride ?? activeProfile),
    })),
    commands,
    showLogo: true,
  };
  process.stderr.write(renderBanner(info, { columns: app.columns, color: app.color }));
}
