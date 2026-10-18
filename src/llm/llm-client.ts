import { brand } from '../brand/brand.js';
import type { LlmProvider, LlmSettings } from '../config/config-schema.js';
import { stripControlCharacters } from '../ui/untrusted-text.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CompletionRequest {
  /** Instructions for the model; sent as the system prompt. */
  system: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
}

export interface LlmClient {
  complete: (request: CompletionRequest) => Promise<string>;
  /** "provider / model", for progress lines. */
  describe: () => string;
}

export interface LlmClientOptions {
  settings: LlmSettings;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URLS: Record<Exclude<LlmProvider, 'litellm'>, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com',
};

const DEFAULT_MAX_TOKENS = 2_000;
const REQUEST_TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = '2023-06-01';

/** Names exactly what is missing, with the command that fixes it, so the user never has to guess. */
export class LlmSetupError extends Error {}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

interface Ready {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

function ready({ settings, apiKey }: LlmClientOptions): Ready {
  const { provider, model } = settings;
  if (!provider || !model) {
    throw new LlmSetupError(
      `No model is set up. Run: ${brand.command} config set llm.provider <litellm|openai|anthropic|gemini>, then: ${brand.command} config set llm.model <model name>`,
    );
  }
  const baseUrl =
    settings.baseUrl ?? (provider === 'litellm' ? undefined : DEFAULT_BASE_URLS[provider]);
  if (!baseUrl) {
    throw new LlmSetupError(
      `The litellm provider needs your gateway URL. Run: ${brand.command} config set llm.baseUrl <url>`,
    );
  }
  if (!apiKey) {
    throw new LlmSetupError(
      "LLM_API_KEY is not set. Put it in the profile's env file (or your shell); for litellm use your own virtual key. It is never stored in the config file.",
    );
  }
  return { provider, model, baseUrl, apiKey };
}

interface Wire {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  read: (json: unknown) => string | undefined;
}

function openAiWire(target: Ready, request: CompletionRequest): Wire {
  return {
    url: joinUrl(target.baseUrl, '/chat/completions'),
    headers: { Authorization: `Bearer ${target.apiKey}` },
    body: {
      model: target.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    },
    read: (json) =>
      (json as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message
        ?.content,
  };
}

function anthropicWire(target: Ready, request: CompletionRequest): Wire {
  return {
    url: joinUrl(target.baseUrl, '/v1/messages'),
    headers: { 'x-api-key': target.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    body: {
      model: target.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: request.messages,
    },
    read: (json) =>
      (json as { content?: Array<{ type?: string; text?: string }> }).content
        ?.filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join(''),
  };
}

const REDACTED = '[redacted]';

/**
 * Cuts a provider's error body to something safe to show: control characters removed, the API key
 * and any bearer-shaped value replaced, and no long dumps. A gateway can echo the key it was sent.
 */
export function briefReason(body: string, apiKey: string): string {
  const withoutKey = apiKey ? body.split(apiKey).join(REDACTED) : body;
  const withoutBearer = withoutKey.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`);
  return stripControlCharacters(withoutBearer).replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Talks to a model over plain HTTP. LiteLLM, OpenAI and Gemini share the OpenAI chat format;
 * Anthropic has its own. No provider SDK is used, so the package depends on none.
 */
export function createLlmClient(options: LlmClientOptions): LlmClient {
  const target = ready(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    describe: () => `${target.provider} / ${target.model}`,
    async complete(request) {
      const wire =
        target.provider === 'anthropic'
          ? anthropicWire(target, request)
          : openAiWire(target, request);
      const response = await fetchImpl(wire.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...wire.headers },
        body: JSON.stringify(wire.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `${target.provider} answered ${response.status} ${response.statusText}: ${briefReason(text, target.apiKey)}`,
        );
      }
      const answer = wire.read(JSON.parse(text));
      if (!answer) throw new Error(`${target.provider} returned no text`);
      return answer;
    },
  };
}
