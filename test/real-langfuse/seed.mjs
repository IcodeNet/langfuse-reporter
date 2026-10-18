/**
 * Seeds a real Langfuse (v4) the way a real chat app does: each chat turn is an OpenTelemetry span sent to the OTLP endpoint
 * with the real-time ingestion header, and each rating is a score posted to the public API. Then it waits until the
 * scores and the turns can be read back, so the tool is not run against half-written data.
 *
 * Usage: node seed.mjs   (LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY in the environment)
 */
import { randomBytes } from 'node:crypto';

const base = process.env.LANGFUSE_BASE_URL ?? 'http://127.0.0.1:3000';
const auth = `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64')}`;
const runId = process.env.SEED_RUN_ID ?? 'real-langfuse';

/** Two sessions: one negative rating with a personal detail in the text, one positive. */
const CONVERSATIONS = [
  {
    key: 't1',
    session: `${runId}-s1`,
    user: 'user-real-1',
    question: 'My email is anna@example.com. What is the rate?',
    answer: 'The rate is 4.1%.',
    helpful: false,
    comment: 'Wrong rate',
    reasons: ['wrong_answer'],
    at: '2026-09-02T10:00:00.000Z',
  },
  {
    key: 't2',
    session: `${runId}-s2`,
    user: 'user-real-2',
    question: 'Thanks',
    answer: 'You are welcome.',
    helpful: true,
    comment: null,
    reasons: [],
    at: '2026-09-03T10:00:00.000Z',
  },
];

const nanos = (iso) => String(BigInt(Date.parse(iso)) * 1_000_000n);
const str = (key, value) => ({ key, value: { stringValue: value } });

async function post(path, body, extraHeaders = {}) {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${text.slice(0, 500)}`);
  return text;
}

/** One OTLP span per chat turn, named like the real app names it, carrying the trace-level attributes on the span. */
const spans = CONVERSATIONS.map((c) => {
  c.traceId = randomBytes(16).toString('hex');
  c.spanId = randomBytes(8).toString('hex');
  return {
    traceId: c.traceId,
    spanId: c.spanId,
    name: 'chat-turn',
    kind: 1,
    startTimeUnixNano: nanos(c.at),
    endTimeUnixNano: nanos(new Date(Date.parse(c.at) + 1000).toISOString()),
    attributes: [
      str('langfuse.observation.type', 'span'),
      str('langfuse.observation.input', c.question),
      str('langfuse.observation.output', c.answer),
      str('langfuse.session.id', c.session),
      str('langfuse.user.id', c.user),
      str('langfuse.environment', 'production'),
      str('langfuse.trace.name', 'chat'),
    ],
  };
});

await post(
  '/api/public/otel/v1/traces',
  {
    resourceSpans: [
      {
        resource: { attributes: [str('service.name', 'real-langfuse-seed')] },
        scopeSpans: [{ scope: { name: 'langfuse-sdk' }, spans }],
      },
    ],
  },
  { 'x-langfuse-ingestion-version': '4' },
);
console.log(`sent ${spans.length} turns over OTLP`);

const scores = CONVERSATIONS.flatMap((c) => [
  { name: 'feedback_helpful', value: c.helpful ? 1 : 0, comment: c.comment, c },
  ...c.reasons.map((reason) => ({ name: `feedback_${reason}`, value: 1, comment: null, c })),
]);
await post('/api/public/ingestion', {
  batch: scores.map((s, index) => ({
    id: `${runId}-${s.c.key}-score-ev-${index}`,
    type: 'score-create',
    timestamp: s.c.at,
    body: {
      id: `${runId}-${s.c.key}-score-${index}`,
      name: s.name,
      value: s.value,
      dataType: 'BOOLEAN',
      traceId: s.c.traceId,
      observationId: s.c.spanId,
      comment: s.comment ?? undefined,
      environment: 'production',
    },
  })),
});
console.log(`sent ${scores.length} scores`);

async function readJson(path, query) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: auth } });
  const text = await response.text();
  let body = { data: [] };
  try {
    body = JSON.parse(text);
  } catch {
    // keep the text for the error message
  }
  return { status: response.status, body, text };
}

const traceIds = new Set(CONVERSATIONS.map((c) => c.traceId));
const deadline = Date.now() + 240_000;
let lastSeen = '(no reply yet)';
for (;;) {
  const scoreReply = await readJson('/api/public/v3/scores', {
    name: 'feedback_helpful',
    fields: 'details,subject',
    limit: '50',
  });
  const turnReply = await readJson('/api/public/v2/observations', {
    name: 'chat-turn',
    fields: 'core,basic,io',
    limit: '50',
    fromStartTime: '2026-09-01T00:00:00Z',
    toStartTime: '2026-10-01T00:00:00Z',
  });
  const ratings = (scoreReply.body.data ?? []).filter((s) => traceIds.has(s.subject?.traceId));
  const turns = (turnReply.body.data ?? []).filter((t) => traceIds.has(t.traceId));
  lastSeen = `scores HTTP ${scoreReply.status}: ${scoreReply.text.slice(0, 300)} | turns HTTP ${turnReply.status}: ${turnReply.text.slice(0, 300)}`;
  if (ratings.length >= CONVERSATIONS.length && turns.length >= CONVERSATIONS.length) {
    console.log(`seeded: ${ratings.length} ratings and ${turns.length} turns readable`);
    break;
  }
  if (Date.now() > deadline) {
    throw new Error(
      `readable after 240 s: ${ratings.length} ratings and ${turns.length} turns. Last reply: ${lastSeen}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
