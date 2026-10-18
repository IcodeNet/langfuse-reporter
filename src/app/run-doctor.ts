import { brand } from '../brand/brand.js';
import { checkConfigFile } from '../config/config-store.js';
import type { ConfigFile } from '../config/config-schema.js';
import { resolveConfig, type ResolvedConfig } from '../config/resolve-config.js';
import { checkOutDir } from '../output/check-out-dir.js';
import type { LangfuseClient, LangfuseScore } from '../langfuse/langfuse-client.js';
import type { Reporter } from '../ui/reporter.js';
import { lastWeekFlags } from './explain-empty.js';
import { isOnTurn, makeClient } from './load-dataset.js';
import { isProduction } from './production.js';
import { demoConfig } from '../demo/demo-config.js';
import { summariseWindow } from './search-criteria.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

/** One link of the chain, with what was found and the exact command that fixes it. */
export interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

/** The parts of the Langfuse client the checks use; a test can supply a fake. */
export type DoctorClient = Pick<LangfuseClient, 'getProject' | 'listScores' | 'getTurns'>;

export interface DoctorRequest {
  configPath: string;
  /** True with --demo: the built-in config is checked instead of the file. */
  demo?: boolean;
  profileOverride: string | undefined;
  reporter: Reporter;
  now: Date;
  /** Builds the client for the resolved config; defaults to the real one. */
  createClient?: (resolved: ResolvedConfig, reporter: Reporter) => DoctorClient;
}

const skipped = (label: string, because: string): Check => ({
  label,
  status: 'skip',
  detail: `skipped: ${because}`,
});

async function checkConfig(
  configPath: string,
  demo = false,
): Promise<{ check: Check; file?: ConfigFile }> {
  if (demo) {
    return {
      check: {
        label: 'Config file',
        status: 'ok',
        detail: 'built-in demo config (no file is read)',
      },
      file: demoConfig(),
    };
  }
  const result = await checkConfigFile(configPath);
  if (result.problems.length > 0) {
    return {
      check: {
        label: 'Config file',
        status: 'fail',
        detail: `${configPath} has ${result.problems.length} problem(s): ${result.problems.join('; ')}`,
        fix: `${brand.command} config check`,
      },
    };
  }
  const detail = result.missing
    ? `no file yet at ${configPath}; the defaults apply`
    : `${configPath} is valid`;
  return {
    check: {
      label: 'Config file',
      status: result.missing ? 'warn' : 'ok',
      detail,
      fix: result.missing ? `${brand.command} config init` : undefined,
    },
    file: result.config,
  };
}

function envFileCheck(resolved: ResolvedConfig): Check {
  const { envFile } = resolved.profile;
  if (resolved.envFileProblem) {
    return {
      label: 'Env file',
      status: 'fail',
      detail: resolved.envFileProblem,
      fix: `${brand.command} --profile ${resolved.profileName} config set profile.envFile <absolute-path>`,
    };
  }
  if (!envFile) {
    return {
      label: 'Env file',
      status: resolved.publicKey ? 'ok' : 'fail',
      detail: resolved.publicKey
        ? 'none set; the keys come from the shell environment'
        : 'none set for this profile, and no keys in the shell environment',
      fix: resolved.publicKey
        ? undefined
        : `${brand.command} --profile ${resolved.profileName} config set profile.envFile ~/.langfuse-${resolved.profileName}.env`,
    };
  }
  return { label: 'Env file', status: 'ok', detail: `${envFile} is readable` };
}

function keysCheck(resolved: ResolvedConfig): Check {
  const missing = [
    resolved.publicKey ? undefined : 'LANGFUSE_PUBLIC_KEY',
    resolved.secretKey ? undefined : 'LANGFUSE_SECRET_KEY',
  ].filter((name) => name !== undefined);
  if (missing.length === 0) {
    return {
      label: 'Keys',
      status: 'ok',
      detail: 'LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY found',
    };
  }
  return {
    label: 'Keys',
    status: 'fail',
    detail: `${missing.join(' and ')} not found${resolved.profile.envFile ? ` in ${resolved.profile.envFile}` : ''}`,
    fix: `add ${missing.join(' and ')} to the env file of profile "${resolved.profileName}"`,
  };
}

async function projectCheck(
  resolved: ResolvedConfig,
  client: DoctorClient,
): Promise<{ check: Check; projectName?: string }> {
  try {
    const project = await client.getProject();
    const production = isProduction(resolved.profileName, project.name);
    return {
      check: {
        label: 'Project',
        status: production ? 'warn' : 'ok',
        detail: production
          ? `${project.name} is PRODUCTION: real customer conversations`
          : `${project.name} (${project.id})`,
      },
      projectName: project.name,
    };
  } catch (err) {
    return {
      check: {
        label: 'Project',
        status: 'fail',
        detail: `Langfuse at ${resolved.profile.baseUrl} refused these keys: ${err instanceof Error ? err.message : String(err)}`,
        fix: `check the keys and the address: ${brand.command} --profile ${resolved.profileName} config show`,
      },
    };
  }
}

function windowCheck(resolved: ResolvedConfig, now: Date): Check {
  const window = summariseWindow(resolved);
  if (!resolved.windowIsDefault) return { label: 'Window', status: 'ok', detail: window };
  return {
    label: 'Window',
    status: 'warn',
    detail: `${window} is the default (the whole previous calendar month); ratings given since then are outside it`,
    fix: `${brand.command} feedback export --dry-run ${lastWeekFlags(now)}`,
  };
}

interface RatingCount {
  onTurn: number;
  onTrace: number;
  /** One rating on a chat turn, for checking that its turn can be read back. */
  sample?: LangfuseScore;
}

async function countRatings(
  resolved: ResolvedConfig,
  client: DoctorClient,
  window: { from: string; to: string },
): Promise<RatingCount> {
  const scores = await client.listScores({
    names: [resolved.conventions.ratingScore],
    from: window.from,
    to: window.to,
    fields: 'subject',
  });
  const onTurn = scores.filter(isOnTurn);
  return { onTurn: onTurn.length, onTrace: scores.length - onTurn.length, sample: onTurn[0] };
}

/**
 * Reads the trace of one rated answer and looks for the rated turn in it. A rating whose turn
 * cannot be found is lost in a real run, however many ratings the count shows.
 */
async function turnProblem(
  resolved: ResolvedConfig,
  client: DoctorClient,
  sample: LangfuseScore | undefined,
): Promise<Check | undefined> {
  if (!sample || !isOnTurn(sample)) return undefined;
  const turns = await client.getTurns('trace', sample.subject.traceId);
  if (turns.some((turn) => turn.id === sample.subject.id)) return undefined;
  return {
    label: 'Ratings',
    status: 'fail',
    detail: `ratings were found, but the answer they were given on is not a "${resolved.conventions.turnName}" observation, so a real run would leave every one out`,
    fix: `${brand.command} config check   (then look at conventions.turnName in: ${brand.command} config show)`,
  };
}

/** The last seven days, ending tomorrow so today is inside. */
function recentWindow(now: Date): { from: string; to: string } {
  const day = (date: Date): string => `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
  return {
    from: day(new Date(now.getTime() - 7 * DAY_MS)),
    to: day(new Date(now.getTime() + DAY_MS)),
  };
}

const DAY_MS = 86_400_000;

async function ratingsCheck(
  resolved: ResolvedConfig,
  client: DoctorClient,
  now: Date,
): Promise<Check> {
  try {
    const inWindow = await countRatings(resolved, client, resolved);
    if (inWindow.onTurn > 0) {
      const lost = await turnProblem(resolved, client, inWindow.sample);
      if (lost) return lost;
      const extra =
        inWindow.onTrace > 0
          ? ` (${inWindow.onTrace} more sit on the whole trace and are ignored)`
          : '';
      return {
        label: 'Ratings',
        status: 'ok',
        detail: `${inWindow.onTurn} on a chat turn in this window${extra}`,
      };
    }
    // An old default window can hold only ratings from before turn-level scores existed.
    const recent = resolved.windowIsDefault
      ? await countRatings(resolved, client, recentWindow(now))
      : undefined;
    if (recent && recent.onTurn > 0) {
      const lost = await turnProblem(resolved, client, recent.sample);
      if (lost) return lost;
      return {
        label: 'Ratings',
        status: 'warn',
        detail: `none on a chat turn in ${summariseWindow(resolved)}, but ${recent.onTurn} in the last 7 days: the setup works, the window is just old`,
        fix: `${brand.command} feedback report ${lastWeekFlags(now)}`,
      };
    }
    if (inWindow.onTrace > 0) {
      return {
        label: 'Ratings',
        status: 'fail',
        detail: `${inWindow.onTrace} found, but all sit on the whole trace, not on a chat turn, so the CLI cannot place them`,
        fix: `the application must record each thumb on the chat-turn: ${brand.command} docs why does it need chat-turn observations`,
      };
    }
    return {
      label: 'Ratings',
      status: 'warn',
      detail: `none named "${resolved.conventions.ratingScore}" in this window`,
      fix: `try a recent window: ${brand.command} feedback export --dry-run ${lastWeekFlags(now)}  (or check conventions.ratingScore in config show)`,
    };
  } catch (err) {
    return {
      label: 'Ratings',
      status: 'fail',
      detail: `could not read scores: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function outDirCheck(resolved: ResolvedConfig): Promise<Check> {
  const problem = await checkOutDir(resolved.outDir);
  if (problem) return { label: 'Output folder', status: 'fail', detail: problem };
  return { label: 'Output folder', status: 'ok', detail: `${resolved.outDir} can be written` };
}

function modelCheck(resolved: ResolvedConfig): Check {
  const { provider, model } = resolved.llm;
  if (provider && model) {
    const hasKey = resolved.llmApiKey !== undefined;
    return {
      label: 'Model',
      status: hasKey ? 'ok' : 'warn',
      detail: `${provider} / ${model}${hasKey ? '' : ', but LLM_API_KEY was not found'}`,
      fix: hasKey ? undefined : 'add LLM_API_KEY to the env file of this profile',
    };
  }
  return {
    label: 'Model',
    status: 'skip',
    detail: 'not set up (only analyse and written docs answers need it)',
    fix: `${brand.command} config set llm.provider litellm   (then llm.model, llm.baseUrl)`,
  };
}

/** Runs every check in chain order and returns them; a broken link makes the ones after it skip, not guess. */
export async function collectChecks(request: DoctorRequest): Promise<Check[]> {
  const { configPath, profileOverride, reporter, now, demo } = request;
  const config = await checkConfig(configPath, demo);
  const checks: Check[] = [config.check];
  if (config.check.status === 'fail' || !config.file) return checks;

  let resolved: ResolvedConfig;
  try {
    resolved = resolveConfig(config.file, { profile: profileOverride }, now);
  } catch (err) {
    checks.push({
      label: 'Profile',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      fix: `${brand.command} config use <name>`,
    });
    return checks;
  }
  checks.push({
    label: 'Profile',
    status: 'ok',
    detail: `"${resolved.profileName}" at ${resolved.profile.baseUrl}`,
  });
  checks.push(
    ...(demo
      ? [
          {
            label: 'Keys',
            status: 'ok' as const,
            detail: 'built-in demo keys; nothing is sent anywhere',
          },
        ]
      : [envFileCheck(resolved), keysCheck(resolved)]),
  );
  const keysOk = checks.every((check) => check.status !== 'fail');
  checks.push(await outDirCheck(resolved));
  checks.push(windowCheck(resolved, now));

  if (!keysOk) {
    checks.push(skipped('Project', 'no usable keys'), skipped('Ratings', 'no usable keys'));
  } else {
    const client = (request.createClient ?? makeClient)(resolved, reporter);
    const project = await projectCheck(resolved, client);
    checks.push(project.check);
    checks.push(
      project.check.status === 'fail'
        ? skipped('Ratings', 'the project could not be opened')
        : await ratingsCheck(resolved, client, now),
    );
  }
  checks.push(modelCheck(resolved));
  return checks;
}

/** Prints the checks and returns how many failed, so the command can set the exit code. */
export async function runDoctor(request: DoctorRequest): Promise<number> {
  const { reporter } = request;
  return reporter.section(`${brand.name} · doctor`, () => reportChecks(request));
}

async function reportChecks(request: DoctorRequest): Promise<number> {
  const { reporter } = request;
  const checks = await collectChecks(request);
  for (const check of checks) {
    const text = `${check.label.padEnd(14)} ${check.detail}`;
    if (check.status === 'ok') reporter.done(text);
    else if (check.status === 'skip') reporter.info(text);
    else reporter.warn(`[${check.status === 'fail' ? 'FAIL' : 'CHECK'}] ${text}`);
    if (check.fix && check.status !== 'ok') reporter.note(`               Fix: ${check.fix}`);
  }
  const failed = checks.filter((check) => check.status === 'fail').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  if (failed === 0 && warned === 0) reporter.done('Every link of the chain is fine.');
  else
    reporter.warn(
      `${failed} failed, ${warned} to check. Fix the first FAIL, then run doctor again.`,
    );
  return failed;
}
