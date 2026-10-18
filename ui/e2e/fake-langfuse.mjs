/** A stand-in Langfuse for the browser test: custom names, one project, three rated answers. */
import { createServer } from 'node:http';

const [port, turnName, ratingScore, reasonPrefix] = process.argv.slice(2);

/** Realistic text for README pictures; the browser tests use the plain text. */
const NICE = process.env.FAKE_NICE === '1';
const QA = {
  1: [
    'How do I reset my password?',
    'Open Settings, choose Security, then Reset password. We email you a link that works for one hour.',
  ],
  2: ['Can I export my data?', 'Data export is not available on any plan.'],
  3: [
    'Why was my payment declined?',
    'Payments are always accepted, so this cannot have happened.',
  ],
};

const turn = (i) => ({
  id: `obs-${i}`,
  traceId: `trace-${i}`,
  startTime: `2026-09-0${i}T10:00:00.000Z`,
  endTime: `2026-09-0${i}T10:00:05.000Z`,
  projectId: 'p1',
  parentObservationId: null,
  type: 'SPAN',
  name: turnName,
  level: 'DEFAULT',
  environment: 'production',
  sessionId: `sess-${i}`,
  userId: `user-${i}`,
  input: NICE ? QA[i][0] : `question ${i}`,
  output: NICE ? QA[i][1] : `answer ${i}`,
});

const score = (i, name, value, comment = null) => ({
  id: `sc-${i}-${name}`,
  projectId: 'p1',
  name,
  dataType: 'BOOLEAN',
  value,
  source: 'API',
  environment: 'production',
  timestamp: `2026-09-0${i}T10:01:00.000Z`,
  createdAt: `2026-09-0${i}T10:01:00.000Z`,
  updatedAt: `2026-09-0${i}T10:01:00.000Z`,
  comment,
  configId: null,
  metadata: {},
  subject: { kind: 'observation', id: `obs-${i}`, traceId: `trace-${i}` },
});

const scores = [
  score(1, ratingScore, true),
  score(
    2,
    ratingScore,
    false,
    NICE ? 'The Pro plan includes export, so this is wrong' : 'too slow',
  ),
  score(2, `${reasonPrefix}wrong_answer`, true),
  score(3, ratingScore, false),
];

const METRIC_VALUES = {
  'observations:environment': ['production'],
  'observations:name': [turnName, 'guardrail', 'model-call'],
  'scores-boolean:name': [...new Set(scores.map((each) => each.name))].sort(),
  'scores-numeric:name': [],
};

createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  const q = url.searchParams;
  let body;
  if (url.pathname === '/api/public/projects') {
    body = {
      data: [
        {
          id: 'p1',
          name: 'Customer Chat',
          organization: { id: 'o', name: 'O' },
          metadata: {},
          retentionDays: null,
        },
      ],
    };
  } else if (url.pathname === '/api/public/v3/scores') {
    const names = q.get('name')?.split(',');
    const traceId = q.get('traceId');
    const observationId = q.get('observationId');
    body = {
      data: scores.filter(
        (each) =>
          (!names || names.includes(each.name)) &&
          (!traceId || each.subject.traceId === traceId) &&
          (!observationId || each.subject.id === observationId),
      ),
      meta: { limit: 100 },
    };
  } else if (url.pathname === '/api/public/v2/observations') {
    const name = q.get('name');
    const traceId = q.get('traceId');
    const sessionId = q.get('sessionId');
    body = {
      data: [1, 2, 3]
        .map(turn)
        .filter(
          (each) =>
            (!name || name === turnName) &&
            (!traceId || each.traceId === traceId) &&
            (!sessionId || each.sessionId === sessionId),
        ),
      meta: {},
    };
  } else if (url.pathname === '/api/public/v2/metrics') {
    const query = JSON.parse(q.get('query') ?? '{}');
    const field = query.dimensions[0].field;
    const values = METRIC_VALUES[`${query.view}:${field}`] ?? [];
    body = { data: values.map((value) => ({ [field]: value })) };
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
}).listen(Number(port), '127.0.0.1');
