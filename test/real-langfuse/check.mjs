/**
 * Runs the built tool against a seeded real Langfuse and checks known answers. The expected values
 * are written here by hand; they come from seed.mjs, never from the tool's own output.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'real-langfuse-'));
const out = join(home, 'out');
const env = { ...process.env, HOME: home, NO_COLOR: '1' };
const failures = [];

function jeves(args) {
  return spawnSync('node', ['dist/index.js', ...args], { env, encoding: 'utf8', timeout: 180_000 });
}

function expect(name, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`}`,
  );
  if (!ok) failures.push(name);
}

const window = ['--from', '2026-09-01', '--to', '2026-10-01'];

const doctor = jeves(['doctor', '--json']);
const doctorJson = JSON.parse(doctor.stdout || '{}');
expect(
  'doctor opens the project the keys belong to',
  doctorJson.checks?.some((c) => c.label === 'Project' && c.status === 'ok'),
  true,
);

/** What the real API returns for the calls the tool makes, shown when something fails. */
async function show(path, query) {
  const url = new URL(path, process.env.LANGFUSE_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const auth = Buffer.from(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
  ).toString('base64');
  const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const text = await response.text();
  console.log(
    `GET ${url.pathname}?${url.searchParams} -> ${response.status} ${text.slice(0, 700)}`,
  );
}
await show('/api/public/v3/scores', {
  name: 'feedback_helpful',
  fields: 'details,subject',
  limit: '5',
});
await show('/api/public/v2/observations', {
  name: 'chat-turn',
  fields: 'core,basic,io',
  limit: '5',
});
await show('/api/public/v2/observations', {
  sessionId: 'real-langfuse-s1',
  name: 'chat-turn',
  fields: 'core,basic,io',
  limit: '5',
});
await show('/api/public/v2/observations', {
  traceId: 'real-langfuse-t1',
  fields: 'core,basic,io',
  limit: '5',
});
const bounds = { fromStartTime: '2026-09-01T00:00:00Z', toStartTime: '2026-10-01T00:00:00Z' };
await show('/api/public/v2/observations', {
  name: 'chat-turn',
  fields: 'core,basic,io',
  limit: '5',
  ...bounds,
});
await show('/api/public/v2/observations', {
  traceId: 'real-langfuse-t1',
  fields: 'core,basic,io',
  limit: '5',
  ...bounds,
});
await show('/api/public/v2/observations', {
  fields: 'core,basic,io',
  limit: '5',
  ...bounds,
  filter: JSON.stringify([
    { type: 'string', column: 'sessionId', operator: '=', value: 'real-langfuse-s1' },
  ]),
});
await show('/api/public/v2/observations', {
  fields: 'core,basic,io',
  limit: '5',
  fromStartTime: '2026-01-01T00:00:00Z',
  toStartTime: '2027-01-01T00:00:00Z',
});
await show('/api/public/observations', { traceId: 'real-langfuse-t1', limit: '5' });
await show('/api/public/traces/real-langfuse-t1', {});

const dry = jeves(['feedback', 'export', '--dry-run', '--json', ...window]);
const counts = JSON.parse(dry.stdout || '{}');
expect('dry run finds two ratings', [counts.found, counts.positive, counts.negative], [2, 1, 1]);

const run = jeves(['feedback', 'export', '--json', '--format', 'json', '--out', out, ...window]);
expect('export exits 0', run.status, 0);
console.log(`files written: ${JSON.stringify(readdirSync(out))}`);
console.log(`export said: ${run.stdout.trim().slice(0, 500)}`);
console.log(
  `export stderr: ${run.stderr
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim()
    .slice(-900)}`,
);
const negativeFile = readdirSync(out).find((name) => name.includes('negative'));
if (negativeFile === undefined) {
  console.error('FAIL no negative file was written');
  process.exit(1);
}
const negative = JSON.parse(readFileSync(join(out, negativeFile ?? ''), 'utf8'));
expect('the negative rating keeps its comment', negative[0]?.comment, 'Wrong rate');
expect('the negative rating keeps its reason', negative[0]?.reasons, ['wrong_answer']);
expect(
  'the email in the question is masked',
  negative[0]?.question.includes('anna@example.com'),
  false,
);

const evalRun = jeves(['feedback', 'export', '--format', 'eval-report', '--out', out, ...window]);
expect('eval-report export exits 0', evalRun.status, 0);
const evalFile = readdirSync(out).find((name) => name.startsWith('eval-report'));
const report = JSON.parse(readFileSync(join(out, evalFile ?? ''), 'utf8'));
expect(
  'the eval report holds one failed row',
  [report.rows.length, report.suites[0]?.failed],
  [1, 1],
);
expect(
  'the eval report row is labelled production-review',
  report.rows[0]?.metadata.provenance.source,
  'production-review',
);

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed against the real Langfuse');
