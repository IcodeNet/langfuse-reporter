import type { ConfigFile } from './config-schema.js';
import { SETTABLE_KEYS, SETTING_DESCRIPTIONS, type SettableKey } from './config-schema.js';

function valueOf(file: ConfigFile, key: SettableKey): string {
  const profile = file.profiles[file.activeProfile];
  switch (key) {
    case 'outDir':
      return file.outDir ?? '(default)';
    case 'profile.baseUrl':
      return profile?.baseUrl ?? '';
    case 'profile.envFile':
      return profile?.envFile ?? '(not set)';
    case 'conventions.reasons':
      return file.conventions.reasons.join(', ');
    case 'conventions.yesValues':
      return file.conventions.yesValues.join(', ');
    case 'llm.provider':
    case 'llm.model':
    case 'llm.baseUrl':
      return (
        file.llm?.[key.slice('llm.'.length) as 'provider' | 'model' | 'baseUrl'] ?? '(not set)'
      );
    default:
      return file.conventions[key.slice('conventions.'.length) as 'turnName'];
  }
}

/**
 * Every setting with its current value and what it means, for `config show`. `profileName` is the profile the run uses (the --profile override
 * when given), so the address and env file shown are the ones that profile will really use.
 */
export function settingRows(
  file: ConfigFile,
  profileName: string = file.activeProfile,
): Array<readonly [string, string]> {
  const shown = { ...file, activeProfile: profileName };
  return SETTABLE_KEYS.map(
    (key) => [key, `${valueOf(shown, key)}   ·   ${SETTING_DESCRIPTIONS[key]}`] as const,
  );
}
