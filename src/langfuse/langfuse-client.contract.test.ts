import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LangfuseClient } from './langfuse-client.js';

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function makeClient(replies: Reply[]): { client: LangfuseClient; urls: URL[] } {
  const urls: URL[] = [];
  const fetchImpl: typeof fetch = (input) => {
    urls.push(new URL(input instanceof Request ? input.url : input.toString()));
    const reply = replies[urls.length - 1] ?? { status: 200, body: { data: [], meta: {} } };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers }),
    );
  };
  const client = new LangfuseClient({
    baseUrl: 'https://langfuse.example.com',
    publicKey: 'pk',
    secretKey: 'sk',
    turnName: 'chat-turn',
    fetchImpl,
  });
  return { client, urls };
}

const window = {
  names: ['feedback_helpful'],
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
};

describe('Langfuse projects response', () => {
  it('should give the project id and name when the response follows the published schema', async () => {
    const { client } = makeClient([{ status: 200, body: loadFixture('projects.json') }]);

    const project = await client.getProject();

    expect(project).toEqual({ id: 'proj-1', name: 'Customer Chat' });
  });
});

describe('Langfuse scores response', () => {
  it('should read boolean, numeric and categorical values as they arrive when scores come on two pages', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('scores-page-1.json') },
      { status: 200, body: loadFixture('scores-page-2.json') },
    ]);

    const scores = await client.listScores(window);

    expect(scores.map((score) => score.value)).toEqual([true, false, 1, 'inaccurate']);
  });

  it('should keep the subject of each score when the score is on an observation or a trace', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('scores-page-1.json') },
      { status: 200, body: loadFixture('scores-page-2.json') },
    ]);

    const scores = await client.listScores(window);

    expect(scores.map((score) => score.subject)).toEqual([
      { kind: 'observation', id: 'obs-1', traceId: 'trace-1' },
      { kind: 'observation', id: 'obs-2', traceId: 'trace-2' },
      { kind: 'trace', id: 'trace-3' },
      { kind: 'observation', id: 'obs-2', traceId: 'trace-2' },
    ]);
  });

  it('should keep a null comment as null and a written comment as text when details are requested', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('scores-page-1.json') },
      { status: 200, body: loadFixture('scores-page-2.json') },
    ]);

    const scores = await client.listScores(window);

    expect(scores.map((score) => score.comment)).toEqual([null, 'Wrong rate quoted', null, null]);
  });

  it('should send the cursor from the first page when it asks for the second', async () => {
    const { client, urls } = makeClient([
      { status: 200, body: loadFixture('scores-page-1.json') },
      { status: 200, body: loadFixture('scores-page-2.json') },
    ]);

    await client.listScores(window);

    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'cursor-page-2']);
  });

  it('should stop after one request when the response carries no cursor', async () => {
    const { client, urls } = makeClient([{ status: 200, body: loadFixture('scores-page-2.json') }]);

    await client.listScores(window);

    expect(urls).toHaveLength(1);
  });

  it('should ask for the details and subject field groups when no fields are given', async () => {
    const { client, urls } = makeClient([{ status: 200, body: loadFixture('scores-page-2.json') }]);

    await client.listScores(window);

    expect(urls[0]?.searchParams.get('fields')).toBe('details,subject');
  });
});

describe('Langfuse observations response', () => {
  it('should return the turns of both pages in order when the conversation spans two pages', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('observations-page-1.json') },
      { status: 200, body: loadFixture('observations-page-2.json') },
    ]);

    const turns = await client.getTurns('session', 'session-1');

    expect(turns.map((turn) => turn.id)).toEqual(['obs-1', 'obs-3', 'obs-4']);
  });

  it('should keep input and output as text or as objects when Langfuse returns either', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('observations-page-1.json') },
      { status: 200, body: loadFixture('observations-page-2.json') },
    ]);

    const turns = await client.getTurns('session', 'session-1');

    expect(turns.map((turn) => turn.output)).toEqual(['The rate is 4.1%.', { text: '4.3%' }, null]);
  });

  it('should keep a null session and user as null when Langfuse has none', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('observations-page-1.json') },
      { status: 200, body: loadFixture('observations-page-2.json') },
    ]);

    const turns = await client.getTurns('session', 'session-1');

    expect(turns.map((turn) => [turn.sessionId, turn.userId])).toEqual([
      ['session-1', 'user-1'],
      ['session-1', 'user-1'],
      [null, null],
    ]);
  });

  it('should ask for the field groups that hold the ids, the environment, the user and the text', async () => {
    const { client, urls } = makeClient([
      { status: 200, body: loadFixture('observations-page-2.json') },
    ]);

    await client.getTurns('trace', 'trace-1');

    expect(urls[0]?.searchParams.get('fields')).toBe('core,basic,io');
  });
});

describe('Langfuse metrics response', () => {
  it('should list the environments once each, sorted, without the blank one, when rows come back', async () => {
    const { client } = makeClient([
      { status: 200, body: loadFixture('metrics-environments.json') },
    ]);

    const environments = await client.listEnvironments(new Date('2026-10-01T00:00:00.000Z'));

    expect(environments).toEqual(['production', 'staging']);
  });
});

describe('Langfuse error responses', () => {
  it('should fail with the status and path when the keys are refused', async () => {
    const { client } = makeClient([{ status: 401, body: { message: 'Unauthorized' } }]);

    await expect(client.getProject()).rejects.toThrow('Langfuse /api/public/projects answered 401');
  });

  it('should not retry when Langfuse answers 400 to an unknown field group', async () => {
    const { client, urls } = makeClient([
      { status: 400, body: { message: 'Unknown field group' } },
    ]);

    await expect(client.listScores(window)).rejects.toThrow('answered 400');
    expect(urls).toHaveLength(1);
  });

  it('should retry and then succeed when Langfuse answers 429 with Retry-After of zero', async () => {
    const { client, urls } = makeClient([
      { status: 429, body: {}, headers: { 'retry-after': '0' } },
      { status: 200, body: loadFixture('projects.json') },
    ]);

    const project = await client.getProject();

    expect(project.id).toBe('proj-1');
    expect(urls).toHaveLength(2);
  });
});

describe('Langfuse error text that echoes the keys', () => {
  const PUBLIC = 'pk-lf-contract-public-key';
  const SECRET = 'sk-lf-contract-secret-key';

  function echoingClient(statusText: string): LangfuseClient {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response('no', { status: 401, statusText }));
    return new LangfuseClient({
      baseUrl: 'https://langfuse.example.com',
      publicKey: PUBLIC,
      secretKey: SECRET,
      turnName: 'chat-turn',
      fetchImpl,
    });
  }

  it.each([
    ['the pair, as a server that decodes the header would echo it', `${PUBLIC}:${SECRET}`],
    ['the secret key alone', SECRET],
    ['the base64 header value', Buffer.from(`${PUBLIC}:${SECRET}`).toString('base64')],
  ])('should not show %s when the status line repeats it', async (_label, echoed) => {
    const failure = await echoingClient(`Unauthorized for ${echoed}`)
      .getProject()
      .catch((err: Error) => `${err.message} ${err.cause ?? ''}`);

    expect(failure).toContain('answered 401');
    expect(failure).not.toContain(PUBLIC);
    expect(failure).not.toContain(SECRET);
    expect(failure).not.toContain(echoed);
  });
});
