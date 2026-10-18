import { describe, expect, it } from 'vitest';
import type { LlmSettings } from '../config/config-schema.js';
import { briefReason, createLlmClient, LlmSetupError } from './llm-client.js';

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function recorder(reply: unknown, status = 200): { seen: Seen[]; fetchImpl: typeof fetch } {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    seen.push({
      url: input instanceof URL ? input.href : (input as string),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
    });
    return Promise.resolve(new Response(JSON.stringify(reply), { status }));
  };
  return { seen, fetchImpl };
}

const OPENAI_REPLY = { choices: [{ message: { content: 'hello' } }] };
const ASK = { system: 'be brief', messages: [{ role: 'user', content: 'hi' }] } as const;
const OPENAI: LlmSettings = { provider: 'openai', model: 'm' };

interface ClientSpec {
  settings: LlmSettings;
  fetchImpl?: typeof fetch;
  /** `null` means no key at all; leaving it out means a normal test key. */
  apiKey?: string | null;
}

function clientFor({ settings, fetchImpl = fetch, apiKey = 'k' }: ClientSpec) {
  return createLlmClient({ settings, apiKey: apiKey ?? undefined, fetchImpl });
}

describe('createLlmClient setup errors', () => {
  it('should say how to pick a provider when none is set', () => {
    expect(() => clientFor({ settings: {} })).toThrow('config set llm.provider');
  });

  it('should say how to pick a model when only the provider is set', () => {
    expect(() => clientFor({ settings: { provider: 'openai' } })).toThrow('config set llm.model');
  });

  it('should ask for the gateway URL when litellm has none', () => {
    expect(() => clientFor({ settings: { provider: 'litellm', model: 'm' } })).toThrow(
      'config set llm.baseUrl',
    );
  });

  it('should ask for LLM_API_KEY when the key is missing', () => {
    expect(() => clientFor({ settings: OPENAI, apiKey: null })).toThrow('LLM_API_KEY');
  });

  it('should raise a setup error the commands can tell apart when the model is not set up', () => {
    expect(() => clientFor({ settings: {} })).toThrow(LlmSetupError);
  });
});

describe('createLlmClient over the OpenAI format', () => {
  it('should post to the gateway chat endpoint with a bearer key when using litellm', async () => {
    const { seen, fetchImpl } = recorder(OPENAI_REPLY);
    const settings: LlmSettings = {
      provider: 'litellm',
      model: 'team-model',
      baseUrl: 'https://gw.example.com/',
    };

    await clientFor({ settings, fetchImpl }).complete(ASK);

    expect(seen[0]?.url).toBe('https://gw.example.com/chat/completions');
    expect(seen[0]?.headers['Authorization']).toBe('Bearer k');
  });

  it('should send the instructions as a system message when asking', async () => {
    const { seen, fetchImpl } = recorder(OPENAI_REPLY);

    await clientFor({ settings: OPENAI, fetchImpl }).complete(ASK);

    expect(seen[0]?.body['messages']).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('should use the OpenAI address by default when the provider is openai', async () => {
    const { seen, fetchImpl } = recorder(OPENAI_REPLY);

    await clientFor({ settings: OPENAI, fetchImpl }).complete(ASK);

    expect(seen[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('should use the Gemini compatible address by default when the provider is gemini', async () => {
    const { seen, fetchImpl } = recorder(OPENAI_REPLY);

    await clientFor({ settings: { provider: 'gemini', model: 'm' }, fetchImpl }).complete(ASK);

    expect(seen[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
  });

  it('should return the model text when the call succeeds', async () => {
    const { fetchImpl } = recorder(OPENAI_REPLY);

    await expect(clientFor({ settings: OPENAI, fetchImpl }).complete(ASK)).resolves.toBe('hello');
  });
});

describe('createLlmClient over the Anthropic format', () => {
  const settings: LlmSettings = { provider: 'anthropic', model: 'claude-x' };
  const reply = {
    content: [
      { type: 'text', text: 'part one ' },
      { type: 'text', text: 'part two' },
    ],
  };

  it('should send the key and version headers when the Anthropic Messages API is called', async () => {
    const { seen, fetchImpl } = recorder(reply);

    await clientFor({ settings, fetchImpl }).complete(ASK);

    expect(seen[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]?.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  });

  it('should put the instructions in the system field when the Anthropic Messages API is called', async () => {
    const { seen, fetchImpl } = recorder(reply);

    await clientFor({ settings, fetchImpl }).complete(ASK);

    expect(seen[0]?.body).toMatchObject({ system: 'be brief', messages: ASK.messages });
  });

  it('should join the text parts of the answer when the model replies in several parts', async () => {
    const { fetchImpl } = recorder(reply);

    await expect(clientFor({ settings, fetchImpl }).complete(ASK)).resolves.toBe(
      'part one part two',
    );
  });
});

describe('createLlmClient failures', () => {
  it('should report the status and a short reason when the provider refuses', async () => {
    const { fetchImpl } = recorder({ error: { message: 'bad key' } }, 401);

    await expect(clientFor({ settings: OPENAI, fetchImpl }).complete(ASK)).rejects.toThrow(
      'openai answered 401',
    );
  });

  it('should never put the API key in an error message when the provider refuses', async () => {
    const { fetchImpl } = recorder({ error: 'nope' }, 500);

    const failure = await clientFor({ settings: OPENAI, fetchImpl, apiKey: 'sekret-key' })
      .complete(ASK)
      .catch((err: Error) => err.message);

    expect(failure).not.toContain('sekret-key');
  });

  it('should fail clearly when the answer has no text', async () => {
    const { fetchImpl } = recorder({ choices: [] });

    await expect(clientFor({ settings: OPENAI, fetchImpl }).complete(ASK)).rejects.toThrow(
      'returned no text',
    );
  });
});

describe('createLlmClient when the call goes wrong', () => {
  it('should say the answer is not JSON when the model address returns a web page', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('<html>login</html>'));

    await expect(clientFor({ settings: OPENAI, fetchImpl }).complete(ASK)).rejects.toThrow(
      'something that is not JSON. Check llm.baseUrl',
    );
  });

  it('should say it could not connect and name the host when the connection fails', async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));

    await expect(clientFor({ settings: OPENAI, fetchImpl }).complete(ASK)).rejects.toThrow(
      'Could not connect to openai at api.openai.com. Check llm.baseUrl and your network.',
    );
  });

  it('should say the model did not answer and for how long when the call times out', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(clientFor({ settings: OPENAI, fetchImpl }).complete(ASK)).rejects.toThrow(
      'did not answer within 120 seconds',
    );
  });
});

describe('briefReason', () => {
  const KEY = 'sk-live-abc123';

  it('should replace the API key when the provider echoes it in an error', () => {
    expect(briefReason(`bad key ${KEY} and again ${KEY}`, KEY)).toBe(
      'bad key [redacted] and again [redacted]',
    );
  });

  it('should replace a bearer-shaped value even when it is not our key', () => {
    expect(briefReason('sent Authorization: Bearer abc.def-ghi', KEY)).toContain(
      'Bearer [redacted]',
    );
  });

  it('should strip terminal control sequences when the provider text contains them', () => {
    const ESC = String.fromCharCode(27);

    expect(briefReason(`oops${ESC}[2J${ESC}]0;x${String.fromCharCode(7)}done`, KEY)).toBe(
      'oopsdone',
    );
  });

  it('should cut the body to 200 characters when the provider error is long', () => {
    expect(briefReason('x'.repeat(500), KEY)).toHaveLength(200);
  });

  it('should not put the key in the error when a call fails', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(`invalid key ${KEY}`, { status: 401 }));

    const message = await createLlmClient({
      settings: { provider: 'openai', model: 'm' },
      apiKey: KEY,
      fetchImpl,
    })
      .complete({ system: 's', messages: [{ role: 'user', content: 'q' }] })
      .catch((err: Error) => err.message);

    expect(message).not.toContain(KEY);
    expect(message).toContain('[redacted]');
  });
});

describe('model error status that echoes the key', () => {
  it('should not show the API key when the status line repeats it', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response('no', { status: 401, statusText: 'bad key sekret-key-123456' }));

    const failure = await clientFor({ settings: OPENAI, fetchImpl, apiKey: 'sekret-key-123456' })
      .complete(ASK)
      .catch((err: Error) => err.message);

    expect(failure).toContain('openai answered 401');
    expect(failure).not.toContain('sekret-key-123456');
  });
});
