import { existsSync, statSync } from 'node:fs';
import type { ConfigFile } from './config-schema.js';

/** The warning for a change, only when the change is what caused it, so an unrelated setting stays quiet. */
export function newEnvFileWarning(
  before: ConfigFile,
  after: ConfigFile,
  profileName: string,
): string | undefined {
  const now = envFileWarning(after, profileName);
  return now !== undefined && now !== envFileWarning(before, profileName) ? now : undefined;
}

/**
 * Problems with the env file of a profile, found right after it is set so the mistake shows now and
 * not at the first export. Undefined when the file is there or none is set.
 */
export function envFileWarning(file: ConfigFile, profileName: string): string | undefined {
  const path = file.profiles[profileName]?.envFile;
  if (!path) return undefined;
  if (!existsSync(path)) {
    return `The env file ${path} does not exist yet. Create it with LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY, or point to the right one: config set profile.envFile <file>`;
  }
  if (statSync(path).isDirectory()) {
    return `${path} is a folder, not a file. Point to the env file inside it: config set profile.envFile <file>`;
  }
  return undefined;
}
