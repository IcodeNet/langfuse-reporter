import { basename } from 'node:path';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { RunInfo } from '../output/run-info.js';
import { CLI_VERSION } from './cli-version.js';

/** Describes the run for the Config and filters sheet; the env file is reduced to its name. */
export function runInfoFor(resolved: ResolvedConfig, where: string | undefined): RunInfo {
  const trimmed = where?.trim();
  return {
    cliVersion: CLI_VERSION,
    generatedAt: new Date(),
    profileName: resolved.profileName,
    envFileName: resolved.profile.envFile ? basename(resolved.profile.envFile) : undefined,
    baseUrl: resolved.profile.baseUrl,
    from: resolved.from,
    to: resolved.to,
    where: trimmed ? trimmed : undefined,
    conventions: resolved.conventions,
  };
}
