import { z } from 'zod';
import { presetWindow } from './window-presets.js';
import { parseRule } from '../queries/query-rules.js';
import { isPlainOneLine } from '../ui/untrusted-text.js';

/** Providers the `docs` and `analyse` commands can call. LiteLLM, OpenAI and Gemini share one wire format. */
export const LLM_PROVIDERS = ['litellm', 'openai', 'anthropic', 'gemini'] as const;

const DEFAULT_LANGFUSE_URL = 'https://cloud.langfuse.com';

const DEFAULT_REASONS = [
  'wrong_answer',
  'incomplete_answer',
  'off_topic',
  'hard_to_follow',
  'harmful_content',
  'other_issue',
  'well_explained',
  'correct_answer',
  'fast_response',
  'easy_to_follow',
  'useful_detail',
  'on_topic',
] as const;

function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be at most ${max} characters`)
    .refine(isPlainOneLine, 'must be plain text on one line');
}

/** Score names travel to Langfuse as one comma-separated query value, so a comma would split a name in two. */
/** The risk areas eval-dashboards groups suites by. Copied as data, not imported: the two tools meet only through the report file. */
export const RISK_AREAS = [
  'compliance',
  'pii',
  'content-safety',
  'prompt-safety',
  'tone-of-voice',
  'factuality',
  'response-quality',
  'tool-use',
  'tool-routing',
  'groundedness',
  'relevance',
  'custom',
] as const;

/** The built-in meaning of each default reason, used when the config names no map. */
export const DEFAULT_RISK_AREAS: readonly string[] = [
  'wrong_answer=factuality',
  'incomplete_answer=response-quality',
  'off_topic=relevance',
  'hard_to_follow=tone-of-voice',
  'harmful_content=content-safety',
];

function riskAreaEntry() {
  return plainText(150).refine(
    (entry) => {
      const [reason, area, ...rest] = entry.split('=');
      return (
        rest.length === 0 &&
        !!reason &&
        !reason.includes(',') &&
        (RISK_AREAS as readonly string[]).includes(area ?? '')
      );
    },
    `must look like reason=area, where area is one of: ${RISK_AREAS.join(', ')}`,
  );
}

function scoreName() {
  return plainText(100).refine((name) => !name.includes(','), 'must not contain a comma');
}

function mustBeUnique(
  values: readonly string[],
  context: z.core.$RefinementCtx<readonly string[]>,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: 'custom',
        path: [index],
        message: `"${value}" is listed twice`,
      });
    }
    seen.add(value);
  });
}

/**
 * How a project records feedback in its Langfuse project. Every field has a default; change them
 * in the config file, or with `config set conventions.<name>`.
 */
export const conventionsSchema = z
  .object({
    turnName: plainText(100).default('chat-turn'),
    ratingScore: scoreName().default('feedback_helpful'),
    reasonScorePrefix: z
      .string()
      .max(100, 'must be at most 100 characters')
      .refine(isPlainOneLine, 'must be plain text on one line')
      .refine((prefix) => !prefix.includes(','), 'must not contain a comma')
      .default('feedback_'),
    reasons: z
      .array(scoreName())
      .superRefine(mustBeUnique)
      .default([...DEFAULT_REASONS]),
    yesValues: z.array(plainText(40)).min(1, 'needs at least one value').default(['true', '1']),
    riskAreas: z.array(riskAreaEntry()).default([...DEFAULT_RISK_AREAS]),
    assistantName: plainText(40).default('Assistant'),
    passLabel: plainText(20).default('Pass'),
    failLabel: plainText(20).default('Fail'),
  })
  .strict();

/** The parts of an address that matter for safety, or undefined when it is not an address at all. */
function addressParts(value: string): URL | undefined {
  return URL.canParse(value) ? new URL(value) : undefined;
}

/** An http or https address with no user name or password in it, so a secret can never be shown or saved by accident. */
const webAddress = z
  .string()
  .url()
  .refine((value) => {
    const parts = addressParts(value);
    return parts === undefined || ['http:', 'https:'].includes(parts.protocol);
  }, 'must start with http:// or https://')
  .refine((value) => {
    const parts = addressParts(value);
    return parts === undefined || (parts.username === '' && parts.password === '');
  }, 'must not contain a user name or password; keys belong in the env file');

export const profileSchema = z
  .object({
    baseUrl: webAddress,
    /** dotenv file holding LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY (and optionally LLM_API_KEY) for this profile. */
    envFile: z.string().min(1).optional(),
  })
  .strict();

/** Every field is optional so each can be set on its own; completeness is checked when a command needs a model. */
const llmSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    baseUrl: webAddress.optional(),
  })
  .strict();

export const queryNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,39}$/,
    'a query name uses lowercase letters, digits and hyphens, up to 40 characters, and starts with a letter or digit',
  );

/** A filter, an optional window word such as 7d, and the rules `query run` checks. */
export const savedQuerySchema = z
  .object({
    where: plainText(2000).optional(),
    window: z
      .string()
      .refine(
        (word) => presetWindow(word, new Date()) !== undefined,
        'must be a window word: today, yesterday, a number of days such as 7d or 14d, this-week, last-week, this-month or last-month',
      )
      .optional(),
    rules: z
      .array(plainText(100))
      .max(20, 'at most 20 rules')
      .default([])
      .superRefine((rules, context) => {
        rules.forEach((rule, index) => {
          const parsed = parseRule(rule);
          if ('problem' in parsed) {
            context.addIssue({ code: 'custom', path: [index], message: parsed.problem });
          }
        });
      }),
  })
  .strict();

export const configFileSchema = z
  .object({
    activeProfile: z.string().min(1),
    outDir: z.string().min(1).optional(),
    conventions: conventionsSchema.prefault({}),
    llm: llmSchema.optional(),
    queries: z.record(queryNameSchema, savedQuerySchema).default({}),
    profiles: z.record(z.string(), profileSchema),
  })
  .strict()
  .superRefine((config, context) => {
    if (Object.keys(config.profiles).length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['profiles'],
        message: 'needs at least one profile',
      });
      return;
    }
    if (!Object.hasOwn(config.profiles, config.activeProfile)) {
      context.addIssue({
        code: 'custom',
        path: ['activeProfile'],
        message: `"${config.activeProfile}" is not one of the profiles: ${Object.keys(config.profiles).join(', ')}`,
      });
    }
  });

export type Profile = z.infer<typeof profileSchema>;
export type LlmSettings = z.infer<typeof llmSchema>;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type Conventions = z.infer<typeof conventionsSchema>;
export type ConfigFile = z.infer<typeof configFileSchema>;
export type SavedQuery = z.infer<typeof savedQuerySchema>;

export const DEFAULT_CONVENTIONS: Conventions = conventionsSchema.parse({});

export const DEFAULT_CONFIG: ConfigFile = configFileSchema.parse({
  activeProfile: 'dev',
  profiles: { dev: { baseUrl: DEFAULT_LANGFUSE_URL } },
});

/** Settable keys, in `<scope>.<name>` form so `config set` can validate them. */
export const SETTABLE_KEYS = [
  'outDir',
  'profile.baseUrl',
  'profile.envFile',
  'conventions.turnName',
  'conventions.ratingScore',
  'conventions.reasonScorePrefix',
  'conventions.reasons',
  'conventions.yesValues',
  'conventions.riskAreas',
  'conventions.assistantName',
  'conventions.passLabel',
  'conventions.failLabel',
  'llm.provider',
  'llm.model',
  'llm.baseUrl',
] as const;

export type SettableKey = (typeof SETTABLE_KEYS)[number];

/** Shown beside each key while typing, so no key needs prior knowledge. */
export const SETTING_DESCRIPTIONS: Record<SettableKey, string> = {
  outDir: 'folder the Excel files are written to',
  'profile.baseUrl': 'Langfuse URL of the active profile, e.g. https://cloud.langfuse.com',
  'profile.envFile': 'env file holding the Langfuse keys (and LLM_API_KEY) of the active profile',
  'conventions.turnName':
    'name of the observation that holds one question and answer (default chat-turn)',
  'conventions.ratingScore':
    'name of the thumbs score recorded on a turn (default feedback_helpful)',
  'conventions.reasonScorePrefix': 'text before each reason in its score name (default feedback_)',
  'conventions.reasons':
    'reasons a user can tick, comma separated, as they appear after the prefix',
  'conventions.yesValues':
    'score values that mean yes or thumbs up, comma separated (default true,1)',
  'conventions.riskAreas':
    'which risk area each reason belongs to, as reason=area, comma separated; added to the five built-in pairs (set a reason to custom to switch its pair off)',
  'conventions.assistantName':
    'name shown on the answer column of the Excel files (default Assistant)',
  'conventions.passLabel': 'word shown for a thumbs up in the Excel files (default Pass)',
  'conventions.failLabel': 'word shown for a thumbs down in the Excel files (default Fail)',
  'llm.provider': `model provider for docs and analyse: ${LLM_PROVIDERS.join(', ')}`,
  'llm.model': 'model name to ask, as the provider or your LiteLLM gateway names it',
  'llm.baseUrl': 'gateway URL; required for litellm, optional for the others',
};

/** Settings whose value is a list, typed on one line with commas. */
export const LIST_KEYS: ReadonlySet<string> = new Set([
  'conventions.reasons',
  'conventions.yesValues',
  'conventions.riskAreas',
]);

export function isSettableKey(key: string): key is SettableKey {
  return (SETTABLE_KEYS as readonly string[]).includes(key);
}

/** The settings rules as JSON Schema, generated from the same zod rules that check the file. */
export function configJsonSchema(): object {
  return z.toJSONSchema(configFileSchema, { target: 'draft-2020-12', io: 'input' });
}
