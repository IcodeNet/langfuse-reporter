import { describe, expect, it } from 'vitest';
import { LangfuseClient, retryDelayMs } from './langfuse-client.js';

describe('retryDelayMs', () => {
  it('should honour the Retry-After header when the server sends seconds', () => {
    expect(retryDelayMs('3', 0)).toBe(3000);
  });

  it('should back off exponentially when there is no Retry-After header', () => {
    expect(retryDelayMs(null, 3)).toBe(8000);
  });
});

interface FakeObservation {
  id: string;
  traceId: string;
  name: string;
  startTime: string;
  environment: string;
  sessionId?: string | null;
  userId?: string | null;
}

function makeObservation(overrides: Partial<FakeObservation> = {}): FakeObservation {
  return {
    id: 'o1',
    traceId: 't1',
    environment: 'uat-like',
    name: 'chat-turn',
    startTime: '2026-09-02T10:16:13.805Z',
    sessionId: 's1',
    userId: 'U-1',
    ...overrides,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) return input.href;
  return input instanceof Request ? input.url : input;
}

function makeClient(pages: Array<{ data: FakeObservation[]; cursor?: string }>): {
  client: LangfuseClient;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    urls.push(requestUrl(input));
    const page = pages[urls.length - 1] ?? { data: [] };
    const body = { data: page.data, meta: page.cursor ? { cursor: page.cursor } : {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const client = new LangfuseClient({
    baseUrl: 'https://langfuse.example.com',
    publicKey: 'pk',
    turnName: 'chat-turn',
    secretKey: 'sk',
    fetchImpl,
  });
  return { client, urls };
}

describe('LangfuseClient.getTurns', () => {
  it('should ask only for chat-turn rows of the conversation when fetching by session', async () => {
    const { client, urls } = makeClient([{ data: [makeObservation()] }]);

    await client.getTurns('session', 's1');

    expect(urls[0]).toContain('/api/public/v2/observations?sessionId=s1&name=chat-turn');
  });

  it('should ask only for chat-turn rows of the trace when fetching by trace', async () => {
    const { client, urls } = makeClient([{ data: [makeObservation()] }]);

    await client.getTurns('trace', 't1');

    expect(urls[0]).toContain('traceId=t1&name=chat-turn');
  });

  it('should never call the endpoint Langfuse is removing when fetching turns', async () => {
    const { client, urls } = makeClient([{ data: [makeObservation()] }]);

    await client.getTurns('session', 's1');

    expect(urls.some((url) => url.includes('/api/public/traces/'))).toBe(false);
  });

  it('should follow the cursor until every page is read when the conversation is long', async () => {
    const { client, urls } = makeClient([
      { data: [makeObservation({ id: 'a' })], cursor: 'next-page' },
      { data: [makeObservation({ id: 'b' })] },
    ]);

    const turns = await client.getTurns('session', 's1');

    expect(turns.map((turn) => turn.id)).toEqual(['a', 'b']);
    expect(urls[1]).toContain('cursor=next-page');
  });

  it('should return no turns when Langfuse has none for the conversation', async () => {
    const { client } = makeClient([{ data: [] }]);

    await expect(client.getTurns('session', 's1')).resolves.toEqual([]);
  });
});

describe('LangfuseClient.listScores filters', () => {
  const base = { names: ['feedback_helpful'], from: '2026-10-13', to: '2026-10-15' };

  it('should send the trace when a trace is given', async () => {
    const { client, urls } = makeClient([{ data: [] }]);

    await client.listScores({ ...base, traceId: 't1' });

    expect(new URL(urls[0] ?? '').searchParams.get('traceId')).toBe('t1');
  });

  it('should send the observation with its trace when both are given', async () => {
    const { client, urls } = makeClient([{ data: [] }]);

    await client.listScores({ ...base, traceId: 't1', observationId: 'o1' });

    const params = new URL(urls[0] ?? '').searchParams;
    expect([params.get('traceId'), params.get('observationId')]).toEqual(['t1', 'o1']);
  });

  it('should not send the observation when no trace is given, because Langfuse refuses it', async () => {
    const { client, urls } = makeClient([{ data: [] }]);

    await client.listScores({ ...base, observationId: 'o1' });

    expect(new URL(urls[0] ?? '').searchParams.has('observationId')).toBe(false);
  });

  it('should send neither when no filter is given', async () => {
    const { client, urls } = makeClient([{ data: [] }]);

    await client.listScores(base);

    const params = new URL(urls[0] ?? '').searchParams;
    expect([params.has('traceId'), params.has('observationId')]).toEqual([false, false]);
  });
});

describe('LangfuseClient.getTurnGroups turn budget', () => {
  const threeTurns = {
    data: [
      makeObservation({ id: 'a' }),
      makeObservation({ id: 'b' }),
      makeObservation({ id: 'c' }),
    ],
  };

  it('should stop with the numbers read when the conversations hold more turns than the budget', async () => {
    const { client } = makeClient([threeTurns, threeTurns, threeTurns]);

    await expect(
      client.getTurnGroups({
        scope: 'session',
        ids: ['s1', 's2', 's3'],
        onError: () => undefined,
        maxTurns: 5,
      }),
    ).rejects.toMatchObject({ name: 'TurnBudgetError', maxTurns: 5 });
  });

  it('should return every conversation when the turns stay within the budget', async () => {
    const { client } = makeClient([threeTurns, threeTurns]);

    const groups = await client.getTurnGroups({
      scope: 'session',
      ids: ['s1', 's2'],
      onError: () => undefined,
      maxTurns: 6,
    });

    expect([...groups.keys()].sort()).toEqual(['s1', 's2']);
  });
});

describe('LangfuseClient.getTurnGroups', () => {
  it('should group turns by the id they were fetched with when looking up many conversations', async () => {
    const { client } = makeClient([
      { data: [makeObservation({ id: 'a' })] },
      { data: [makeObservation({ id: 'b' })] },
    ]);

    const groups = await client.getTurnGroups({
      scope: 'session',
      ids: ['s1', 's2'],
      onError: () => undefined,
    });

    expect([...groups.keys()].sort()).toEqual(['s1', 's2']);
  });

  it('should report a failed lookup and still return the others when one conversation fails', async () => {
    const failed: string[] = [];
    const client = new LangfuseClient({
      baseUrl: 'https://langfuse.example.com',
      publicKey: 'pk',
      turnName: 'chat-turn',
      secretKey: 'sk',
      fetchImpl: (input) =>
        Promise.resolve(
          requestUrl(input).includes('sessionId=bad')
            ? new Response('no', { status: 404 })
            : new Response(JSON.stringify({ data: [], meta: {} })),
        ),
    });

    const groups = await client.getTurnGroups({
      scope: 'session',
      ids: ['bad', 'good'],
      onError: (id) => failed.push(id),
    });

    expect(failed).toEqual(['bad']);
    expect([...groups.keys()]).toEqual(['good']);
  });
});

describe('getProject', () => {
  it('should return the project the keys belong to when Langfuse answers', async () => {
    const client = new LangfuseClient({
      baseUrl: 'https://example.test',
      publicKey: 'pk',
      turnName: 'chat-turn',
      secretKey: 'sk',
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: 'p1', name: 'acme-development' }] })),
    });

    await expect(client.getProject()).resolves.toEqual({
      id: 'p1',
      name: 'acme-development',
    });
  });

  it('should fail clearly when the keys open no project', async () => {
    const client = new LangfuseClient({
      baseUrl: 'https://example.test',
      publicKey: 'pk',
      turnName: 'chat-turn',
      secretKey: 'sk',
      fetchImpl: async () => new Response(JSON.stringify({ data: [] })),
    });

    await expect(client.getProject()).rejects.toThrow('no project for these API keys');
  });
});

describe('listEnvironments', () => {
  const NOW = new Date('2026-10-14T10:00:00.000Z');

  function makeEnvClient(body: unknown, urls: string[] = []): LangfuseClient {
    return new LangfuseClient({
      baseUrl: 'https://example.test',
      publicKey: 'pk',
      turnName: 'chat-turn',
      secretKey: 'sk',
      fetchImpl: async (input) => {
        urls.push(requestUrl(input));
        return new Response(JSON.stringify(body));
      },
    });
  }

  it('should return the sorted environment names when Langfuse groups observations by environment', async () => {
    const client = makeEnvClient({
      data: [
        { environment: 'production', count_count: '9' },
        { environment: 'preprod', count_count: '4' },
      ],
    });

    await expect(client.listEnvironments(NOW)).resolves.toEqual(['preprod', 'production']);
  });

  it('should skip rows with no environment name when Langfuse returns blanks', async () => {
    const client = makeEnvClient({
      data: [{ environment: '' }, { count_count: '1' }, { environment: 'uat-like' }],
    });

    await expect(client.listEnvironments(NOW)).resolves.toEqual(['uat-like']);
  });

  it('should look back 90 days from now when building the query', async () => {
    const urls: string[] = [];
    await makeEnvClient({ data: [] }, urls).listEnvironments(NOW);

    expect(decodeURIComponent(urls[0] ?? '')).toContain(
      '"fromTimestamp":"2026-07-16T10:00:00.000Z"',
    );
  });
});
