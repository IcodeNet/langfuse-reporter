import { unknownProfileMessage } from './config-store.js';
import type { ConfigFile } from './config-schema.js';

/**
 * Runs `change` against the --profile override when one is given, then restores which profile is
 * active, so editing a non-active profile never changes which one is active.
 */
export function applyToProfile(
  file: ConfigFile,
  profileOverride: string | undefined,
  change: (file: ConfigFile) => ConfigFile,
): ConfigFile {
  if (!profileOverride) return change(file);
  if (!Object.hasOwn(file.profiles, profileOverride)) {
    throw new Error(unknownProfileMessage(profileOverride, Object.keys(file.profiles)));
  }
  const changed = change({ ...file, activeProfile: profileOverride });
  return { ...changed, activeProfile: file.activeProfile };
}
