import { brand } from '../brand/brand.js';
import { relativeBoundary } from './window-presets.js';
import { unknownProfileMessage } from './config-store.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { IS_INSTALLED, packagePath } from '../package-root.js';
import { parse as parseDotenv } from 'dotenv';
import {
  profileSchema,
  type ConfigFile,
  type Conventions,
  type LlmSettings,
  type Profile,
} from './config-schema.js';
import { parseCalendarDate } from './calendar-date.js';
import { readSmallTextFileSync } from './safe-read.js';
import { isDemoBaseUrl } from '../demo/demo-constants.js';

/**
 * Anchored to a fixed place, not the shell's cwd, so exports always land in the same place. In a
 * checkout that is the package's own `reports/` folder. An installed package lives in node_modules,
 * which can be read-only and is replaced on update, so reports go to a folder in the home folder.
 */
const DEFAULT_REPORTS_DIR = IS_INSTALLED
  ? resolve(homedir(), `${brand.command}-reports`)
  : packagePath('reports');

export interface RunOverrides {
  profile?: string;
  from?: string;
  to?: string;
  outDir?: string;
}

export interface ResolvedConfig {
  profileName: string;
  profile: Profile;
  outDir: string;
  from: string;
  to: string;
  /** True when neither --from nor --to was given, so the window is the previous calendar month. */
  windowIsDefault: boolean;
  publicKey: string | undefined;
  secretKey: string | undefined;
  /** Why the profile's env file could not be read, if it could not. */
  envFileProblem: string | undefined;
  conventions: Conventions;
  llm: LlmSettings;
  /** Key for the model provider; kept out of the config file like the Langfuse keys. */
  llmApiKey: string | undefined;
}

/** First day of last calendar month through the first day of this month, in UTC. */
export function lastMonthWindow(now: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

interface Secrets {
  /** Set when the profile's env file could not be read; only commands that need keys fail on it. */
  envFileProblem?: string;
  publicKey: string | undefined;
  secretKey: string | undefined;
  llmApiKey: string | undefined;
}

/** A relative path counts from the folder the CLI runs in, so show where it was really looked for. */
function describeEnvFile(envFile: string): string {
  const absolute = resolve(envFile);
  return absolute === envFile ? envFile : `${envFile} (looked in ${absolute})`;
}

/** Our own refusals say why; for anything else show only the system code, never file contents. */
function describeReadError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === 'string') return code;
  return err instanceof Error ? err.message : 'error';
}

/**
 * A profile's env file wins over the shell and is never copied into process.env, so switching
 * profiles in one session cannot leak the previous profile's keys.
 */
function readSecrets(envFile: string | undefined): Secrets {
  if (!envFile) {
    return {
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      llmApiKey: process.env.LLM_API_KEY,
    };
  }
  let values: Record<string, string>;
  try {
    values = parseDotenv(readSmallTextFileSync(envFile));
  } catch (err) {
    return {
      publicKey: undefined,
      secretKey: undefined,
      llmApiKey: process.env.LLM_API_KEY,
      envFileProblem: `Cannot read the env file ${describeEnvFile(envFile)}: ${describeReadError(err)}. Save a full path with: ${brand.command} config set profile.envFile <absolute-path>`,
    };
  }
  return {
    publicKey: values.LANGFUSE_PUBLIC_KEY,
    secretKey: values.LANGFUSE_SECRET_KEY,
    llmApiKey: values.LLM_API_KEY ?? process.env.LLM_API_KEY,
  };
}

interface BoundaryRequest {
  flag: string;
  value: string | undefined;
  now: Date;
  /** True for --to: a relative day then means the end of that day, so `--to today` includes today. */
  asEnd: boolean;
}

/** Accepts 2026-09-01 or a full ISO timestamp with a zone and returns ISO; rejects anything else early. */
function normaliseBoundary(request: BoundaryRequest): string | undefined {
  const { flag, value, now, asEnd } = request;
  if (value === undefined) return undefined;
  const relative = relativeBoundary(value, now, asEnd);
  if (relative) return relative;
  const parsed = parseCalendarDate(value);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `${flag} "${value}" is not a real date. Use 2026-09-01, 2026-09-01T10:00:00Z, today, yesterday or -7d`,
    );
  }
  return new Date(parsed).toISOString();
}

/** Merges the saved config with per-run flags and reads the profile's secrets from its env file. */
/**
 * A pipeline has no config file to edit, so `LANGFUSE_BASE_URL` (the name Langfuse's own tools use)
 * sets the address of the profile for this run. It is checked by the same rule as the file, and it is
 * never written to the file. A profile for the demo keeps its own address.
 */
export function withEnvironmentAddress(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): Profile {
  const fromEnvironment = env.LANGFUSE_BASE_URL?.trim().replace(/^"|"$/g, '');
  if (!fromEnvironment || isDemoBaseUrl(profile.baseUrl)) return profile;
  const checked = profileSchema.shape.baseUrl.safeParse(fromEnvironment);
  if (!checked.success) {
    const reason = checked.error.issues[0]?.message ?? 'invalid';
    const hint = reason.includes('http://') ? '' : ' It must start with http:// or https://.';
    throw new Error(`LANGFUSE_BASE_URL is not a usable address (${reason}).${hint}`);
  }
  return { ...profile, baseUrl: checked.data };
}

export function resolveConfig(
  file: ConfigFile,
  overrides: RunOverrides,
  now: Date = new Date(),
): ResolvedConfig {
  const profileName = overrides.profile ?? file.activeProfile;
  const chosen = Object.hasOwn(file.profiles, profileName) ? file.profiles[profileName] : undefined;
  if (!chosen) {
    throw new Error(unknownProfileMessage(profileName, Object.keys(file.profiles)));
  }
  const profile = withEnvironmentAddress(chosen);
  const secrets: Secrets = isDemoBaseUrl(profile.baseUrl)
    ? { publicKey: 'demo-public-key', secretKey: 'demo-secret-key', llmApiKey: undefined }
    : readSecrets(profile.envFile);

  const window = lastMonthWindow(now);
  const from =
    normaliseBoundary({ flag: '--from', value: overrides.from, now, asEnd: false }) ?? window.from;
  const to =
    normaliseBoundary({ flag: '--to', value: overrides.to, now, asEnd: true }) ?? window.to;
  if (Date.parse(from) >= Date.parse(to)) {
    throw new Error(`--from (${from.slice(0, 10)}) must be before --to (${to.slice(0, 10)})`);
  }
  return {
    profileName,
    profile,
    outDir: overrides.outDir ?? file.outDir ?? DEFAULT_REPORTS_DIR,
    from,
    to,
    windowIsDefault: overrides.from === undefined && overrides.to === undefined,
    publicKey: secrets.publicKey,
    secretKey: secrets.secretKey,
    envFileProblem: secrets.envFileProblem,
    conventions: file.conventions,
    llm: file.llm ?? {},
    llmApiKey: secrets.llmApiKey,
  };
}
