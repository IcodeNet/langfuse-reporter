import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in Langfuse holding a dataset built by hand, with the traps a real project has. Every
 * expected value in the accuracy test is worked out from this file, never from a program's output.
 */

interface Turn {
  id: string;
  traceId: string;
  sessionId: string | null;
  userId: string | null;
  startTime: string;
  input: unknown;
  output: unknown;
}

/** Turns served for \`chat-turn\`. The observation id o1 is used in three different traces on purpose. */
const TURNS: Turn[] = [
  {
    id: 'o1',
    traceId: 'T1',
    sessionId: 'S1',
    userId: 'user-ben',
    startTime: '2026-09-02T10:00:00.000Z',
    input: 'What is the rate?',
    output: 'The rate is 4.1%.',
  },
  {
    id: 'o1',
    traceId: 'T2',
    sessionId: 'S1',
    userId: 'user-ben',
    startTime: '2026-09-02T10:05:00.000Z',
    input: 'And for two years?',
    output: 'It is 3.9%.',
  },
  {
    id: 'o9',
    traceId: 'T3',
    sessionId: 'S1',
    userId: 'user-ben',
    startTime: '2026-09-02T10:10:00.000Z',
    input: 'Thanks',
    output: 'You are welcome.',
  },
  {
    id: 'o1',
    traceId: 'T4',
    sessionId: 'S2',
    userId: 'user-cat',
    startTime: '2026-09-20T09:00:00.000Z',
    input: 'Rated at the window end',
    output: 'Should be left out.',
  },
  {
    id: 'o1',
    traceId: 'T6',
    sessionId: 'S3',
    userId: 'user-dan',
    startTime: '2026-09-10T07:55:00.000Z',
    input: "Qu'est-ce que le taux ?\nSecond line",
    output: 'Le taux est de 4,1 % — très bon ✓',
  },
  {
    id: 'o1',
    traceId: 'T7',
    sessionId: 'S4',
    userId: 'user-anna-7',
    startTime: '2026-09-11T08:00:00.000Z',
    input: 'My email is anna@example.com and my card is 4111 1111 1111 1111',
    output: 'I cannot use that.',
  },
];

interface Score {
  id: string;
  name: string;
  value: boolean | number;
  dataType: 'BOOLEAN' | 'NUMERIC';
  timestamp: string;
  comment: string | null;
  subject: { kind: 'observation' | 'trace'; id: string; traceId?: string };
}

const onTurn = (traceId: string, id: string) => ({ kind: 'observation' as const, id, traceId });

/** The scores. The timestamps sit on and around the window 2026-09-01 (included) to 2026-10-01 (not included). */
const SCORES: Score[] = [
  {
    id: 's1',
    name: 'feedback_helpful',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-02T11:00:00.000Z',
    comment: null,
    subject: onTurn('T1', 'o1'),
  },
  {
    id: 's1r',
    name: 'feedback_correct_answer',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-02T11:00:00.000Z',
    comment: null,
    subject: onTurn('T1', 'o1'),
  },
  {
    id: 's2',
    name: 'feedback_helpful',
    value: false,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-03T09:00:00.000Z',
    comment: 'He said "4.1%", not 3,9%',
    subject: onTurn('T2', 'o1'),
  },
  {
    id: 's2r',
    name: 'feedback_wrong_answer',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-03T09:00:00.000Z',
    comment: null,
    subject: onTurn('T2', 'o1'),
  },
  {
    id: 's2x',
    name: 'feedback_off_topic',
    value: false,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-03T09:00:00.000Z',
    comment: null,
    subject: onTurn('T2', 'o1'),
  },
  {
    id: 's3',
    name: 'feedback_helpful',
    value: 1,
    dataType: 'NUMERIC',
    timestamp: '2026-09-01T00:00:00.000Z',
    comment: null,
    subject: onTurn('T3', 'o9'),
  },
  {
    id: 's4',
    name: 'feedback_helpful',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-10-01T00:00:00.000Z',
    comment: 'on the end edge',
    subject: onTurn('T4', 'o1'),
  },
  {
    id: 's5',
    name: 'feedback_helpful',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-08-31T23:59:59.999Z',
    comment: 'before the start',
    subject: onTurn('T4', 'o1'),
  },
  {
    id: 's6',
    name: 'feedback_helpful',
    value: false,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-05T12:00:00.000Z',
    comment: 'on the whole trace',
    subject: { kind: 'trace', id: 'T6' },
  },
  {
    id: 's7',
    name: 'feedback_helpful',
    value: false,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-06T12:00:00.000Z',
    comment: 'turn no longer returned',
    subject: onTurn('T5', 'o1'),
  },
  {
    id: 's8',
    name: 'feedback_helpful',
    value: false,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-10T08:00:00.000Z',
    comment: 'ça ne va pas',
    subject: onTurn('T6', 'o1'),
  },
  {
    id: 's8r',
    name: 'feedback_hard_to_follow',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-10T08:00:00.000Z',
    comment: null,
    subject: onTurn('T6', 'o1'),
  },
  {
    id: 's9',
    name: 'feedback_helpful',
    value: true,
    dataType: 'BOOLEAN',
    timestamp: '2026-09-11T08:30:00.000Z',
    comment: null,
    subject: onTurn('T7', 'o1'),
  },
];

const PAGE_SIZE = 2;

function page<T>(
  items: T[],
  cursor: string | null,
): { data: T[]; meta: { cursor?: string; limit: number } } {
  const start = Number(cursor ?? 0);
  const end = start + PAGE_SIZE;
  return {
    data: items.slice(start, end),
    meta: { limit: PAGE_SIZE, ...(end < items.length ? { cursor: String(end) } : {}) },
  };
}

function scoreBody(score: Score): Record<string, unknown> {
  return {
    id: score.id,
    projectId: 'proj-gold',
    name: score.name,
    value: score.value,
    dataType: score.dataType,
    source: 'API',
    environment: 'production',
    timestamp: score.timestamp,
    createdAt: score.timestamp,
    updatedAt: score.timestamp,
    comment: score.comment,
    configId: null,
    metadata: {},
    subject: score.subject,
  };
}

function turnBody(turn: Turn): Record<string, unknown> {
  return {
    ...turn,
    endTime: turn.startTime,
    projectId: 'proj-gold',
    parentObservationId: null,
    type: 'SPAN',
    name: 'chat-turn',
    level: 'DEFAULT',
    environment: 'production',
  };
}

export interface GoldenLangfuse {
  url: string;
  /** Paths and queries the tool asked for, so a test can see that nothing but reads was sent. */
  requests: Array<{ method: string; path: string }>;
  close: () => Promise<void>;
}

export async function startGoldenLangfuse(): Promise<GoldenLangfuse> {
  const requests: GoldenLangfuse['requests'] = [];
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const q = url.searchParams;
    requests.push({ method: request.method ?? '', path: url.pathname });
    let body: unknown;
    if (url.pathname === '/api/public/projects') {
      body = {
        data: [
          {
            id: 'proj-gold',
            name: 'Golden Project',
            organization: { id: 'o', name: 'O' },
            metadata: {},
            retentionDays: null,
          },
        ],
      };
    } else if (url.pathname === '/api/public/v3/scores') {
      const names = q.get('name')?.split(',');
      const from = q.get('fromTimestamp');
      const to = q.get('toTimestamp');
      const traceId = q.get('traceId');
      const observationId = q.get('observationId');
      const matching = SCORES.filter(
        (score) =>
          (!names || names.includes(score.name)) &&
          (!from || score.timestamp >= from) &&
          (!to || score.timestamp < to) &&
          (!traceId || (score.subject.traceId ?? score.subject.id) === traceId) &&
          (!observationId || score.subject.id === observationId),
      );
      const result = page(matching, q.get('cursor'));
      body = { data: result.data.map(scoreBody), meta: result.meta };
    } else if (url.pathname === '/api/public/v2/observations') {
      const traceId = q.get('traceId');
      const sessionId = q.get('sessionId');
      const matching = TURNS.filter(
        (turn) =>
          q.get('name') === 'chat-turn' &&
          (!traceId || turn.traceId === traceId) &&
          (!sessionId || turn.sessionId === sessionId),
      );
      const result = page(matching, q.get('cursor'));
      body = { data: result.data.map(turnBody), meta: result.meta };
    } else if (url.pathname === '/api/public/v2/metrics') {
      body = { data: [] };
    } else {
      response.writeHead(404).end();
      return;
    }
    const text = JSON.stringify(body);
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text),
    });
    response.end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
