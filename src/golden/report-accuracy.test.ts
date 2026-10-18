import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGoldenLangfuse, type GoldenLangfuse } from './golden-langfuse.js';
import { readXlsx } from './read-xlsx.js';

/**
 * The accuracy gate. A fake Langfuse holds a dataset built by hand (see golden-langfuse.ts) and every
 * expected value below is a literal worked out from that dataset, not copied from a program's output.
 *
 * Window: 2026-09-01 (included) to 2026-10-01 (not included). Ratings that belong in the report:
 *   T3/o9   2026-09-01T00:00:00Z  positive (score 1)             on the window start
 *   T1/o1   2026-09-02T11:00:00Z  positive, reason correct_answer
 *   T2/o1   2026-09-03T09:00:00Z  negative, reason wrong_answer, comment with quotes and commas
 *   T6/o1   2026-09-10T08:00:00Z  negative, reason hard_to_follow, French text with a line break
 *   T7/o1   2026-09-11T08:30:00Z  positive, question holds an email and a card number
 * Left out on purpose: T4 on the window end and one before the window start, a rating on the whole
 * trace T6, and a rating on T5 whose turn Langfuse no longer returns.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const FROM = '2026-09-01';
const TO = '2026-10-01';

let golden: GoldenLangfuse;
let workdir: string;
let configPath: string;

beforeAll(async () => {
  golden = await startGoldenLangfuse();
  workdir = mkdtempSync(join(tmpdir(), 'golden-'));
  writeFileSync(
    join(workdir, 'keys.env'),
    'LANGFUSE_PUBLIC_KEY=pk-golden\nLANGFUSE_SECRET_KEY=sk-golden\n',
  );
  configPath = join(workdir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      activeProfile: 'dev',
      outDir: join(workdir, 'out'),
      profiles: { dev: { baseUrl: golden.url, envFile: join(workdir, 'keys.env') } },
    }),
  );
});

afterAll(async () => {
  await golden.close();
});

/**
 * Runs the real program. It must not block this process: the stand-in Langfuse lives here, and a
 * blocked process cannot answer the program's requests. It runs in `folder`, so a relative path
 * given to the program lands in a temp folder and not in the repository.
 */
function jeves(
  args: string[],
  extraEnv: Record<string, string> = {},
  folder: string = ROOT,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const withConfig = args[0] === '--config' ? args : ['--config', configPath, ...args];
    const child = spawn(TSX, [join(ROOT, 'src/index.ts'), ...withConfig], {
      cwd: folder,
      env: { ...process.env, NO_COLOR: '1', HOME: workdir, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`jeves ${args.join(' ')} did not finish in 60 seconds`));
    }, 60_000);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

interface Row {
  created: string;
  rating: string;
  reasons: string[];
  comment: string;
  environment: string;
  traceId: string;
  sessionId: string;
  observationId: string;
  turnNumber: number;
  question: string;
  answer: string;
}

const EXPECTED: Row[] = [
  {
    created: '2026-09-01T00:00:00.000Z',
    rating: 'positive',
    reasons: [],
    comment: '',
    environment: 'production',
    traceId: 'T3',
    sessionId: 'S1',
    observationId: 'o9',
    turnNumber: 3,
    question: 'Thanks',
    answer: 'You are welcome.',
  },
  {
    created: '2026-09-02T11:00:00.000Z',
    rating: 'positive',
    reasons: ['correct_answer'],
    comment: '',
    environment: 'production',
    traceId: 'T1',
    sessionId: 'S1',
    observationId: 'o1',
    turnNumber: 1,
    question: 'What is the rate?',
    answer: 'The rate is 4.1%.',
  },
  {
    created: '2026-09-03T09:00:00.000Z',
    rating: 'negative',
    reasons: ['wrong_answer'],
    comment: 'He said "4.1%", not 3,9%',
    environment: 'production',
    traceId: 'T2',
    sessionId: 'S1',
    observationId: 'o1',
    turnNumber: 2,
    question: 'And for two years?',
    answer: 'It is 3.9%.',
  },
  {
    created: '2026-09-10T08:00:00.000Z',
    rating: 'negative',
    reasons: ['hard_to_follow'],
    comment: 'ça ne va pas',
    environment: 'production',
    traceId: 'T6',
    sessionId: 'S3',
    observationId: 'o1',
    turnNumber: 1,
    question: "Qu'est-ce que le taux ?\nSecond line",
    answer: 'Le taux est de 4,1 % — très bon ✓',
  },
  {
    created: '2026-09-11T08:30:00.000Z',
    rating: 'positive',
    reasons: [],
    comment: '',
    environment: 'production',
    traceId: 'T7',
    sessionId: 'S4',
    observationId: 'o1',
    turnNumber: 1,
    question: 'My email is [email] and my card is [card]',
    answer: 'I cannot use that.',
  },
];

const byTrace = (a: Row, b: Row): number => a.traceId.localeCompare(b.traceId);

describe('report accuracy against a hand-built Langfuse', () => {
  it('should print exactly the five expected ratings, each field correct, when the report is asked for as JSON', async () => {
    const run = await jeves(['feedback', 'report', '--format', 'json', '--from', FROM, '--to', TO]);

    expect(run.code).toBe(0);
    expect((JSON.parse(run.stdout) as Row[]).sort(byTrace)).toEqual([...EXPECTED].sort(byTrace));
  });

  it('should leave out the rating on the window end, the one before the start, the whole-trace one and the missing turn', async () => {
    const run = await jeves(['feedback', 'report', '--format', 'json', '--from', FROM, '--to', TO]);

    const traces = (JSON.parse(run.stdout) as Row[]).map((row) => row.traceId).sort();
    expect(traces).toEqual(['T1', 'T2', 'T3', 'T6', 'T7']);
  });

  it('should tell the user plainly that one rating was left out because its answer is gone', async () => {
    const run = await jeves(['feedback', 'report', '--format', 'json', '--from', FROM, '--to', TO]);

    expect(run.stderr).toContain('1 rating(s) point at an answer Langfuse no longer returns');
  });

  it('should include a rating exactly on the window start and exclude one exactly on the window end', async () => {
    const run = await jeves(['feedback', 'report', '--format', 'json', '--from', FROM, '--to', TO]);

    const created = (JSON.parse(run.stdout) as Row[]).map((row) => row.created);
    expect([
      created.includes('2026-09-01T00:00:00.000Z'),
      created.includes('2026-10-01T00:00:00.000Z'),
    ]).toEqual([true, false]);
  });

  it('should keep a rating of one with the same observation id apart from another trace when ids repeat', async () => {
    const run = await jeves(['feedback', 'report', '--format', 'json', '--from', FROM, '--to', TO]);

    const rows = JSON.parse(run.stdout) as Row[];
    const t1 = rows.find((row) => row.traceId === 'T1');
    const t2 = rows.find((row) => row.traceId === 'T2');
    expect([t1?.answer, t2?.answer]).toEqual(['The rate is 4.1%.', 'It is 3.9%.']);
  });

  it('should write a CSV with the same ratings, quoting commas, quotes and line breaks correctly', async () => {
    const out = join(workdir, 'csv');
    await jeves([
      'feedback',
      'export',
      '--format',
      'csv',
      '--from',
      FROM,
      '--to',
      TO,
      '--out',
      out,
    ]);

    const text = readdirSync(out)
      .map((name) => readFileSync(join(out, name), 'utf8'))
      .join('\n');
    expect(text).toContain('"He said ""4.1%"", not 3,9%"');
    expect(text).toContain('"Qu\'est-ce que le taux ?\nSecond line"');
  });

  it('should write JSON files that hold the three positive and two negative ratings when the format is JSON', async () => {
    const out = join(workdir, 'json');
    await jeves([
      'feedback',
      'export',
      '--format',
      'json',
      '--from',
      FROM,
      '--to',
      TO,
      '--out',
      out,
    ]);

    const counts = Object.fromEntries(
      readdirSync(out).map((name) => [
        name.split('-')[1],
        (JSON.parse(readFileSync(join(out, name), 'utf8')) as Row[]).length,
      ]),
    );
    expect(counts).toEqual({ positive: 3, negative: 2 });
  });

  it('should write Excel files whose rows match the expected ratings cell by cell', async () => {
    const out = join(workdir, 'xlsx');
    await jeves(['feedback', 'export', '--from', FROM, '--to', TO, '--out', out]);

    const negative = readXlsx(
      readFileSync(join(out, readdirSync(out).find((name) => name.includes('negative')) ?? '')),
    );
    const rows = negative['Feedback per turn'] ?? [];
    const header = rows[0] ?? [];
    const cell = (row: string[], name: string): string => row[header.indexOf(name)] ?? '';
    const body = rows
      .slice(1)
      .sort((a, b) => cell(a, 'Trace id').localeCompare(cell(b, 'Trace id')));
    expect(
      body.map((row) => [
        cell(row, 'Date (UTC)'),
        cell(row, 'Result'),
        cell(row, 'Categories ticked'),
        cell(row, 'Comment'),
        cell(row, 'Turn #'),
        cell(row, 'Turns in conversation'),
        cell(row, 'Trace id'),
      ]),
    ).toEqual([
      ['2026-09-03 09:00:00', 'Fail', 'wrong_answer', 'He said "4.1%", not 3,9%', '2', '3', 'T2'],
      ['2026-09-10 08:00:00', 'Fail', 'hard_to_follow', 'ça ne va pas', '1', '1', 'T6'],
    ]);
  });

  it('should state the right row count, window and source on the method sheet of each Excel file', async () => {
    const out = join(workdir, 'xlsx');
    const files = readdirSync(out);

    const facts = files.map((name) => {
      const method = readXlsx(readFileSync(join(out, name)))['Method and caveats'] ?? [];
      const get = (item: string): string => method.find((row) => row[0] === item)?.[1] ?? '';
      return [name.includes('positive') ? 'positive' : 'negative', get('Rows'), get('Date window')];
    });
    expect(facts.sort()).toEqual([
      ['negative', '2', '2026-09-01 to 2026-10-01 (UTC, end not included)'],
      ['positive', '3', '2026-09-01 to 2026-10-01 (UTC, end not included)'],
    ]);
  });

  it('should give the Excel cell the whole conversation with the rated turn marked when a conversation has three turns', async () => {
    const out = join(workdir, 'xlsx');
    const negative = readXlsx(
      readFileSync(join(out, readdirSync(out).find((name) => name.includes('negative')) ?? '')),
    );
    const rows = negative['Feedback per turn'] ?? [];
    const header = rows[0] ?? [];
    const t2 = rows.find((row) => row[header.indexOf('Trace id')] === 'T2') ?? [];

    expect(t2[header.indexOf('Full conversation')]).toBe(
      '[1]\nUser: What is the rate?\nAssistant: The rate is 4.1%.\n\n[2] ◀ RATED\nUser: And for two years?\nAssistant: It is 3.9%.\n\n[3]\nUser: Thanks\nAssistant: You are welcome.',
    );
  });

  it('should never write the email, the card number or a user id in the clear when masking is on', async () => {
    const files = ['csv', 'json', 'xlsx'].flatMap((folder) => {
      const dir = join(workdir, folder);
      return readdirSync(dir).map((name) => readFileSync(join(dir, name)));
    });

    const leaks = files.filter((file) =>
      /anna@example\.com|4111 1111 1111 1111|user-ben|user-cat|user-dan|user-anna-7/.test(
        file.toString('latin1'),
      ),
    );
    expect(leaks).toHaveLength(0);
  });

  it('should only read from Langfuse when a full export runs', async () => {
    const methods = new Set(golden.requests.map((request) => request.method));

    expect([...methods]).toEqual(['GET']);
  });

  it('should count the six ratings in the window in a dry run, including the one whose answer is gone, and say so', async () => {
    const run = await jeves(['feedback', 'export', '--dry-run', '--from', FROM, '--to', TO]);

    expect([
      run.stderr.includes('6 of 6 ratings selected (3 positive, 3 negative)'),
      run.stderr.includes(
        'A rating whose answer Langfuse no longer returns would only show up in a real run.',
      ),
    ]).toEqual([true, true]);
  });

  it('should keep only the two negative ratings when the filter is rating = negative', async () => {
    const run = await jeves([
      'feedback',
      'report',
      '--format',
      'json',
      '--from',
      FROM,
      '--to',
      TO,
      '--where',
      'rating = negative',
    ]);

    expect((JSON.parse(run.stdout) as Row[]).map((row) => row.traceId).sort()).toEqual([
      'T2',
      'T6',
    ]);
  });

  it('should keep only the rating with the wrong_answer reason when the filter names that category', async () => {
    const run = await jeves([
      'feedback',
      'report',
      '--format',
      'json',
      '--from',
      FROM,
      '--to',
      TO,
      '--where',
      'category IN (wrong_answer)',
    ]);

    expect((JSON.parse(run.stdout) as Row[]).map((row) => row.traceId)).toEqual(['T2']);
  });

  it('should print counts and the written files as JSON on stdout when --json is given', async () => {
    const out = join(workdir, 'json-out');
    const run = await jeves([
      'feedback',
      'export',
      '--format',
      'json',
      '--from',
      FROM,
      '--to',
      TO,
      '--out',
      out,
      '--json',
    ]);

    const outcome = JSON.parse(run.stdout) as {
      found: number;
      selected: number;
      positive: number;
      negative: number;
      dryRun: boolean;
      files: Array<{ kind: string; path: string }>;
    };
    expect([
      outcome.found,
      outcome.selected,
      outcome.positive,
      outcome.negative,
      outcome.dryRun,
      outcome.files.map((file) => file.kind).sort(),
    ]).toEqual([5, 5, 3, 2, false, ['negative', 'positive']]);
  });

  it('should list no files and report the dry-run count when --json and --dry-run are given together', async () => {
    const run = await jeves([
      'feedback',
      'export',
      '--dry-run',
      '--json',
      '--from',
      FROM,
      '--to',
      TO,
    ]);

    expect(JSON.parse(run.stdout)).toEqual({
      found: 6,
      selected: 6,
      positive: 3,
      negative: 3,
      dryRun: true,
      countedFromRatingsOnly: true,
      files: [],
      replaced: false,
    });
  });

  it('should count the same as a real export and say nothing about missing answers when the dry run reads the conversations', async () => {
    const dry = await jeves([
      'feedback',
      'export',
      '--dry-run',
      '--json',
      '--where',
      'session = S1',
      '--from',
      FROM,
      '--to',
      TO,
    ]);

    expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, countedFromRatingsOnly: false });
  });

  it('should exit with 3 and say so when nothing matches and --fail-if-empty is given', async () => {
    const run = await jeves([
      'feedback',
      'export',
      '--dry-run',
      '--json',
      '--fail-if-empty',
      '--from',
      FROM,
      '--to',
      TO,
      '--where',
      'comment CONTAINS zzzznomatch',
    ]);

    expect([
      run.code,
      run.stderr.includes('No ratings matched, and --fail-if-empty was given.'),
    ]).toEqual([3, true]);
  });

  it('should exit with 0 when nothing matches and --fail-if-empty is not given', async () => {
    const run = await jeves([
      'feedback',
      'export',
      '--dry-run',
      '--json',
      '--from',
      FROM,
      '--to',
      TO,
      '--where',
      'comment CONTAINS zzzznomatch',
    ]);

    expect(run.code).toBe(0);
  });

  it('should use LANGFUSE_BASE_URL from the environment when the config file has no reachable address', async () => {
    const bare = join(workdir, 'bare.json');
    writeFileSync(
      bare,
      JSON.stringify({
        activeProfile: 'dev',
        profiles: { dev: { baseUrl: 'http://127.0.0.1:1', envFile: join(workdir, 'keys.env') } },
      }),
    );

    const run = await jeves(
      ['--config', bare, 'feedback', 'export', '--dry-run', '--json', '--from', FROM, '--to', TO],
      { LANGFUSE_BASE_URL: golden.url },
    );

    expect(JSON.parse(run.stdout).found).toBe(6);
  });

  it('should report absolute file paths that exist when the output folder is given as a relative one', async () => {
    const run = await jeves(
      [
        'feedback',
        'export',
        '--format',
        'csv',
        '--from',
        FROM,
        '--to',
        TO,
        '--out',
        'relative-out',
        '--json',
      ],
      {},
      workdir,
    );

    const files = (JSON.parse(run.stdout) as { files: Array<{ path: string }> }).files;
    expect(files.map((file) => [isAbsolute(file.path), existsSync(file.path)])).toEqual([
      [true, true],
      [true, true],
    ]);
  });
});
