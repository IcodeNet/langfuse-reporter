import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ZodError } from 'zod';
import { ConfigFileError, configProblemMessage, describeConfigIssues } from './config-issues.js';
import {
  configFileSchema,
  conventionsSchema,
  DEFAULT_CONFIG,
  isSettableKey,
  LIST_KEYS,
  profileSchema,
  SETTABLE_KEYS,
  type ConfigFile,
  type LlmSettings,
  type Profile,
} from './config-schema.js';
import { brand } from '../brand/brand.js';
import { readSmallTextFile, readSmallTextFileSync } from './safe-read.js';
import { stripJsonComments } from './strip-comments.js';

function configPathIn(folder: string): string {
  return join(homedir(), '.config', folder, 'config.json');
}

export function defaultConfigPath(): string {
  return process.env.LANGFUSE_CLI_CONFIG ?? configPathIn(brand.configDir);
}

export interface ConfigCheck {
  config: ConfigFile | undefined;
  /** Plain-words problems, each with the dotted path to the value, e.g. `conventions.turnName: must not be empty`. */
  problems: string[];
}

/** Checks a config file's text against the schema without throwing. `//` and `/* *\/` comments are allowed. */
export function checkConfigText(text: string): ConfigCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonComments(text));
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'not valid JSON';
    return { config: undefined, problems: [`the file is not valid JSON: ${reason}`] };
  }
  const parsed = configFileSchema.safeParse(raw);
  if (parsed.success) return { config: parsed.data, problems: [] };
  return { config: undefined, problems: describeConfigIssues(parsed.error, raw) };
}

function parseOrThrow(path: string, text: string): ConfigFile {
  const { config, problems } = checkConfigText(text);
  if (!config) throw new ConfigFileError(configProblemMessage(path, problems));
  return config;
}

export async function loadConfigFile(path: string): Promise<ConfigFile> {
  let text: string;
  try {
    text = await readSmallTextFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    throw err;
  }
  return parseOrThrow(path, text);
}

/** Reads and checks the file without defaulting a missing file, so `config check` can say it is absent. */
export async function checkConfigFile(path: string): Promise<ConfigCheck & { missing: boolean }> {
  try {
    return { ...checkConfigText(await readSmallTextFile(path)), missing: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: DEFAULT_CONFIG, problems: [], missing: true };
    }
    throw err;
  }
}

/**
 * Writes to a side file and renames it over the real one. A rename replaces the file in one step,
 * so a reader that arrives mid-save sees the old file or the new one, never an empty half-written file.
 */
export async function saveConfigFile(path: string, config: ConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const side = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(side, `${JSON.stringify(configFileSchema.parse(config), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(side, path);
  } catch (err) {
    await rm(side, { force: true });
    throw err;
  }
}

/**
 * One problem in plain words. The key the user typed already says where they are, so only the
 * part inside it is added: the list position for a repeated reason, nothing for a single value.
 */
function describeIssue(key: string, issue: ZodError['issues'][number]): string {
  const lastPart = key.split('.').at(-1);
  const inside = issue.path.filter((part, index) => !(index === 0 && part === lastPart));
  const where = inside.map((part) => (typeof part === 'number' ? `[${part + 1}]` : part));
  return where.length === 0 ? issue.message : `${where.join('')}: ${issue.message}`;
}

function readable(key: string, err: unknown): Error {
  if (!(err instanceof ZodError)) return err instanceof Error ? err : new Error(String(err));
  const reasons = err.issues.map((issue) => describeIssue(key, issue)).join('; ');
  return new Error(`Invalid value for ${key}: ${reasons}`, { cause: err });
}

/** Returns a new config with `key` set; throws a readable error on a bad key or value. */
export function setConfigValue(config: ConfigFile, key: string, value: string): ConfigFile {
  try {
    return applySetting(config, key, value);
  } catch (err) {
    throw readable(key, err);
  }
}

/** A list setting is typed on one line with commas: `a, b, c`. */
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** The shell expands ~ on the command line, but not inside the session, so both must give the same path. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

/** A path setting is kept as a full path, because a relative one only works from the folder it was typed in. */
const PATH_KEYS: ReadonlySet<string> = new Set(['outDir', 'profile.envFile']);

const SETTING_EXAMPLES: Readonly<Record<string, string>> = {
  outDir: '~/feedback',
  'profile.baseUrl': 'https://cloud.langfuse.com',
  'profile.envFile': '~/.langfuse-dev.env',
};

/**
 * One pair of matching quotes around a typed value is dropped: a shell removes them before the
 * program sees them, but the session does not, and `set outDir "my reports"` must not save the
 * quote characters as part of a folder name.
 */
export function withoutSurroundingQuotes(value: string): string {
  const text = value.trim();
  const first = text[0];
  const quoted = text.length >= 2 && (first === '"' || first === "'") && text.at(-1) === first;
  return quoted ? text.slice(1, -1) : value;
}

function applySetting(config: ConfigFile, key: string, typed: string): ConfigFile {
  const value = withoutSurroundingQuotes(typed);
  if (!isSettableKey(key)) {
    throw new Error(`Unknown config key "${key}". Valid keys: ${SETTABLE_KEYS.join(', ')}`);
  }
  if (value.trim() === '' && key in SETTING_EXAMPLES) {
    const example = SETTING_EXAMPLES[key];
    throw new Error(
      `${key} needs a value. Example: config set ${key} ${example}. To go back to the default use: config unset ${key}`,
    );
  }
  if (key === 'outDir') {
    return configFileSchema.parse({ ...config, outDir: resolve(expandHome(value)) });
  }
  if (key.startsWith('llm.')) {
    const llm = { ...config.llm, [key.slice('llm.'.length)]: value };
    return configFileSchema.parse({ ...config, llm });
  }
  if (key.startsWith('conventions.')) {
    const name = key.slice('conventions.'.length);
    const next = LIST_KEYS.has(key) ? parseList(value) : value;
    const conventions = conventionsSchema.parse({ ...config.conventions, [name]: next });
    return configFileSchema.parse({ ...config, conventions });
  }
  const profileKey = key.slice('profile.'.length);
  const stored = PATH_KEYS.has(key) ? resolve(expandHome(value)) : value;
  const current = config.profiles[config.activeProfile];
  if (!current) throw new Error(`Active profile "${config.activeProfile}" does not exist`);
  const updated = profileSchema.parse({ ...current, [profileKey]: stored });
  return { ...config, profiles: { ...config.profiles, [config.activeProfile]: updated } };
}

export function unsetConfigValue(config: ConfigFile, key: string): ConfigFile {
  if (!isSettableKey(key)) {
    throw new Error(`Unknown config key "${key}". Valid keys: ${SETTABLE_KEYS.join(', ')}`);
  }
  if (key === 'outDir') return { ...config, outDir: undefined };
  if (key.startsWith('llm.')) {
    const { [key.slice('llm.'.length) as keyof LlmSettings]: _removed, ...rest } = config.llm ?? {};
    return { ...config, llm: rest };
  }
  if (key.startsWith('conventions.')) {
    const name = key.slice('conventions.'.length);
    const { [name as keyof typeof config.conventions]: _removed, ...rest } = config.conventions;
    return { ...config, conventions: conventionsSchema.parse(rest) };
  }
  const profileKey = key.slice('profile.'.length);
  const current = config.profiles[config.activeProfile];
  if (!current) throw new Error(`Active profile "${config.activeProfile}" does not exist`);
  if (profileKey === 'baseUrl') {
    const reset = profileSchema.parse({
      ...current,
      baseUrl: DEFAULT_CONFIG.profiles.dev?.baseUrl,
    });
    return { ...config, profiles: { ...config.profiles, [config.activeProfile]: reset } };
  }
  const { [profileKey as keyof typeof current]: _removed, ...rest } = current;
  const updated = profileSchema.parse(rest);
  return { ...config, profiles: { ...config.profiles, [config.activeProfile]: updated } };
}

/** Names the profiles that exist and both ways forward: switch to one, or create the new one. */
export function unknownProfileMessage(name: string, known: readonly string[]): string {
  return `Profile "${name}" does not exist. Existing: ${known.join(', ')}. Switch with: config use <name>. Create it with: config use ${name} --base-url <url>`;
}

function parseNewProfile(baseUrl: string): Profile {
  try {
    return profileSchema.parse({ baseUrl });
  } catch (err) {
    throw new Error(
      `"${baseUrl}" is not a web address. Use the full address, for example: --base-url https://cloud.langfuse.com`,
      { cause: err },
    );
  }
}

/** Creates the profile from the active one when missing, then makes it active. */
export function useProfile(config: ConfigFile, name: string, baseUrl?: string): ConfigFile {
  const existing = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
  if (existing) return { ...config, activeProfile: name };
  if (!baseUrl) throw new Error(unknownProfileMessage(name, Object.keys(config.profiles)));
  const created = parseNewProfile(baseUrl);
  return { ...config, activeProfile: name, profiles: { ...config.profiles, [name]: created } };
}

export interface ProfileListing {
  activeProfile: string;
  profiles: Array<{ name: string; baseUrl: string; envFile?: string }>;
}

/** Synchronous so help text can list profiles; a missing or broken file yields the defaults. */
export function listProfilesSync(path: string): ProfileListing {
  let file: ConfigFile = DEFAULT_CONFIG;
  try {
    file = checkConfigText(readSmallTextFileSync(path)).config ?? DEFAULT_CONFIG;
  } catch {
    file = DEFAULT_CONFIG;
  }
  return {
    activeProfile: file.activeProfile,
    profiles: Object.entries(file.profiles).map(([name, profile]) => ({
      name,
      baseUrl: profile.baseUrl,
      envFile: profile.envFile,
    })),
  };
}
