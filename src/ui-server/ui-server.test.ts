import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueueFullError } from './limit-concurrency.js';
import {
  isLocalHost,
  CONTENT_SECURITY_POLICY,
  cliProblem,
  resolveStaticPath,
  settingMessage,
  themeLines,
  writtenFiles,
  startUiServer,
  type RunningUiServer,
} from './ui-server.js';

const TOKEN = 'test-token';
const DOCTOR_JSON = JSON.stringify({
  failed: 0,
  checks: [{ label: 'Keys', status: 'ok', detail: 'found' }],
});

let server: RunningUiServer;
let port: number;
let staticDir: string;

function get(path: string, headers: Record<string, string> = {}, method = 'GET', payload?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

beforeEach(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'ui-static-'));
  writeFileSync(join(staticDir, 'index.html'), '<html>page</html>');
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(staticDir, '..', 'ui-secret.txt'), 'outside');
  server = await startUiServer({
    staticDir,
    token: TOKEN,
    runCli: () => Promise.resolve({ code: 1, stdout: DOCTOR_JSON, stderr: '' }),
  });
  port = Number(new URL(server.url).port);
});

afterEach(async () => {
  await server.close();
});

describe('isLocalHost', () => {
  it('should accept 127.0.0.1 and localhost with the right port when the host header is checked', () => {
    expect([isLocalHost('127.0.0.1:4000', 4000), isLocalHost('localhost:4000', 4000)]).toEqual([
      true,
      true,
    ]);
  });

  it('should refuse another name or another port when the host header is checked', () => {
    expect([
      isLocalHost('evil.example:4000', 4000),
      isLocalHost('127.0.0.1:4001', 4000),
      isLocalHost(undefined, 4000),
    ]).toEqual([false, false, false]);
  });

  it.each([
    '127.0.0.1:4000:x',
    '127.0.0.1:4000:evil',
    'localhost:4000:',
    '127.0.0.1:40000',
    '127.0.0.1:400',
    '127.0.0.1',
    ' 127.0.0.1:4000',
    '127.0.0.1:4000 ',
    '127.0.0.1:4000.evil.example',
    'evil.example:4000@127.0.0.1:4000',
    '127.0.0.1.evil.example:4000',
    '[::1]:4000',
  ])('should refuse %j because it is not exactly this computer and this port', (header) => {
    expect(isLocalHost(header, 4000)).toBe(false);
  });

  it('should accept the name in any letter case when it is exactly this computer and this port', () => {
    expect([isLocalHost('LOCALHOST:4000', 4000), isLocalHost('LocalHost:4000', 4000)]).toEqual([
      true,
      true,
    ]);
  });
});

describe('ui server', () => {
  it('should answer 401 when the request has no token', async () => {
    expect((await get('/')).status).toBe(401);
  });

  it('should answer 401 when the token is wrong', async () => {
    expect((await get('/?token=nope')).status).toBe(401);
  });

  it('should serve the page when the token is in the address', async () => {
    const reply = await get(`/?token=${TOKEN}`);

    expect(reply.body).toBe('<html>page</html>');
  });

  it('should answer 403 when the host header is not this computer', async () => {
    const reply = await get(`/?token=${TOKEN}`, { host: `evil.example:${port}` });

    expect(reply.status).toBe(403);
  });

  it('should answer 500 and keep serving when the request path cannot be parsed as a URL', async () => {
    const broken = await get('//');
    const after = await get(`/?token=${TOKEN}`);

    expect([broken.status, after.status]).toEqual([500, 200]);
  });

  it('should answer 405 when the method is not GET', async () => {
    expect((await get(`/?token=${TOKEN}`, {}, 'PUT')).status).toBe(405);
  });

  it('should answer 404 and not leave the page folder when the path climbs out of it', async () => {
    const reply = await get(`/..%2fui-secret.txt?token=${TOKEN}`);

    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain('outside');
  });

  it('should answer 404 when the file type is not one the page uses', async () => {
    writeFileSync(join(staticDir, 'notes.txt'), 'x');

    expect((await get(`/notes.txt?token=${TOKEN}`)).status).toBe(404);
  });

  it('should return the doctor result when the token is sent in the header', async () => {
    const reply = await get('/api/doctor', { 'x-setup-token': TOKEN });

    expect(JSON.parse(reply.body)).toEqual(JSON.parse(DOCTOR_JSON));
  });

  it('should answer 502 without the error text when the doctor cannot run', async () => {
    await server.close();
    server = await startUiServer({
      staticDir,
      token: TOKEN,
      runCli: () => Promise.reject(new Error('sk-lf-SECRETMARKER failed')),
    });
    port = Number(new URL(server.url).port);

    const reply = await get('/api/doctor', { 'x-setup-token': TOKEN });

    expect(reply.status).toBe(502);
    expect(reply.body).not.toContain('SECRETMARKER');
  });

  it('should set no-store and a content security policy when it serves the page', async () => {
    const res = await new Promise<Record<string, unknown>>((resolve) => {
      request({ host: '127.0.0.1', port, path: `/?token=${TOKEN}` }, (r) =>
        resolve(r.headers),
      ).end();
    });

    expect([
      res['cache-control'],
      String(res['content-security-policy']).includes("default-src 'self'"),
    ]).toEqual(['no-store', true]);
  });

  it('should make a different token each time when none is given', async () => {
    const other = await startUiServer({
      staticDir,
      runCli: () => Promise.resolve({ code: 0, stdout: '{}', stderr: '' }),
    });
    await other.close();

    expect(other.token).not.toBe(TOKEN);
    expect(other.token).toHaveLength(48);
  });
});

describe('ui server file browser', () => {
  beforeEach(() => {
    mkdirSync(join(staticDir, 'sub'));
    writeFileSync(join(staticDir, 'dev.env'), 'LANGFUSE_SECRET_KEY=sk-lf-SECRETMARKER');
    writeFileSync(join(staticDir, '.hidden'), 'x');
  });

  const browse = (path: string, extra = '') =>
    get(`/api/browse?path=${encodeURIComponent(path)}${extra}`, { 'x-setup-token': TOKEN });

  it('should list folders first and then files when a folder is browsed', async () => {
    const reply = await browse(staticDir);

    expect(JSON.parse(reply.body).entries.map((e: { name: string }) => e.name)).toEqual([
      'assets',
      'sub',
      'dev.env',
      'index.html',
    ]);
  });

  it('should never contain a file content when a folder holding an env file is browsed', async () => {
    const reply = await browse(staticDir);

    expect(reply.body).not.toContain('SECRETMARKER');
  });

  it('should hide dot files unless they are asked for', async () => {
    const hidden = await browse(staticDir, '&hidden=1');

    expect([
      (await browse(staticDir)).body.includes('.hidden'),
      hidden.body.includes('.hidden'),
    ]).toEqual([false, true]);
  });

  it('should answer 400 when the path is relative', async () => {
    expect((await browse('../etc')).status).toBe(400);
  });

  it('should answer 404 when the folder does not exist', async () => {
    expect((await browse(join(staticDir, 'nope'))).status).toBe(404);
  });

  it('should answer 404 when the path is a file, not a folder', async () => {
    expect((await browse(join(staticDir, 'dev.env'))).status).toBe(404);
  });

  it('should answer 401 when the browse request has no token', async () => {
    expect((await get(`/api/browse?path=${encodeURIComponent(staticDir)}`)).status).toBe(401);
  });
});

describe('ui server config set', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    get(
      '/api/config-set',
      { 'x-setup-token': TOKEN, 'content-type': 'application/json', ...headers },
      'POST',
      JSON.stringify(body),
    );

  let calls: string[][];

  beforeEach(async () => {
    calls = [];
    await server.close();
    server = await startUiServer({
      staticDir,
      token: TOKEN,
      runCli: (args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: '', stderr: 'saved to x' });
      },
    });
    port = Number(new URL(server.url).port);
  });

  it('should pass a known setting to the CLI when the body names it', async () => {
    await post({ key: 'conventions.turnName', value: 'my-turn' });

    expect(calls).toEqual([['config', 'set', 'conventions.turnName', 'my-turn']]);
  });

  it('should refuse a key that is not a settable setting and run nothing', async () => {
    const reply = await post({ key: 'profiles', value: 'x' });

    expect([reply.status, calls]).toEqual([400, []]);
  });

  it('should refuse a value that starts with a dash so it cannot become a CLI option', async () => {
    const reply = await post({ key: 'outDir', value: '--config' });

    expect([reply.status, calls]).toEqual([400, []]);
  });

  it('should refuse a request from another origin and run nothing', async () => {
    const reply = await post({ key: 'outDir', value: '/tmp/x' }, { origin: 'http://evil.example' });

    expect([reply.status, calls]).toEqual([400, []]);
  });

  it('should refuse a body that is not JSON content', async () => {
    const reply = await post({ key: 'outDir', value: '/tmp/x' }, { 'content-type': 'text/plain' });

    expect([reply.status, calls]).toEqual([400, []]);
  });

  it('should answer 404 when another POST path is used', async () => {
    const reply = await get('/api/doctor', { 'x-setup-token': TOKEN }, 'POST', '{}');

    expect(reply.status).toBe(404);
  });

  it('should report the CLI message when the CLI refuses the value', async () => {
    await server.close();
    server = await startUiServer({
      staticDir,
      token: TOKEN,
      runCli: () =>
        Promise.resolve({
          code: 2,
          stdout: '',
          stderr: 'Invalid value for outDir: must not be empty',
        }),
    });
    port = Number(new URL(server.url).port);

    const reply = await post({ key: 'outDir', value: ' ' });

    expect(JSON.parse(reply.body)).toEqual({
      ok: false,
      message: 'Invalid value for outDir: must not be empty',
    });
  });
});

describe('resolveStaticPath', () => {
  it('should map the root to the index page when the path is a slash', () => {
    expect(resolveStaticPath('/srv/page', '/')).toBe('/srv/page/index.html');
  });

  it('should refuse a path that climbs out of the folder when it names a page file type', () => {
    expect(resolveStaticPath('/srv/page', '/../secret.html')).toBeUndefined();
  });

  it('should refuse a path that climbs out of the folder from inside a sub folder', () => {
    expect(resolveStaticPath('/srv/page', '/assets/../../secret.js')).toBeUndefined();
  });

  it('should refuse a sibling folder that shares the folder name as a prefix', () => {
    expect(resolveStaticPath('/srv/page', '/../page-private/a.html')).toBeUndefined();
  });

  it('should refuse the folder itself and a file type the page does not use', () => {
    expect([
      resolveStaticPath('/srv/page', '/assets'),
      resolveStaticPath('/srv/page', '/notes.txt'),
    ]).toEqual([undefined, undefined]);
  });
});

describe('settingMessage', () => {
  it('should keep the saved line and drop the banner box when the CLI saved the setting', () => {
    const stderr =
      '… Setting outDir\n✓ Setting outDir: saved to /tmp/c.json\n╭─ Jeves ─╮\n│ config file │\n╰────╯\n';

    expect(settingMessage({ code: 0, stdout: '', stderr })).toBe('saved to /tmp/c.json');
  });

  it('should keep the reason when the CLI refused the value', () => {
    const stderr = '… Setting x\n✗ Setting x: Invalid value for x: must not be empty\n';

    expect(settingMessage({ code: 2, stdout: '', stderr })).toBe(
      'Invalid value for x: must not be empty',
    );
  });

  it('should return an empty text when the CLI printed nothing about the setting', () => {
    expect(settingMessage({ code: 0, stdout: '', stderr: '' })).toBe('');
  });
});

describe('ui server cookie', () => {
  it('should set an HttpOnly SameSite cookie with the token when the page is served', async () => {
    const headers = await new Promise<Record<string, unknown>>((resolve) => {
      request({ host: '127.0.0.1', port, path: `/?token=${TOKEN}` }, (r) =>
        resolve(r.headers),
      ).end();
    });

    expect(headers['set-cookie']).toEqual([
      `setup_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
    ]);
  });

  it('should serve a page asset when only the cookie carries the token', async () => {
    const reply = await get('/assets/app.js', { cookie: `setup_token=${TOKEN}` });

    expect(reply.body).toBe('console.log(1)');
  });

  it('should refuse a page asset when the cookie holds a wrong token', async () => {
    expect((await get('/assets/app.js', { cookie: 'setup_token=nope' })).status).toBe(401);
  });

  it('should not set a cookie when an asset is served', async () => {
    const headers = await new Promise<Record<string, unknown>>((resolve) => {
      request(
        {
          host: '127.0.0.1',
          port,
          path: '/assets/app.js',
          headers: { cookie: `setup_token=${TOKEN}` },
        },
        (r) => resolve(r.headers),
      ).end();
    });

    expect(headers['set-cookie']).toBeUndefined();
  });
});

const ROWS = Array.from({ length: 7 }, (_, index) => ({
  created: `2026-09-0${index + 1}T10:00:00.000Z`,
  rating: index % 2 === 0 ? 'positive' : 'negative',
  question: `question ${String(index).padStart(2, '0')}`,
}));

describe('ui server report routes', () => {
  const post = (path: string, body: unknown) =>
    get(
      path,
      { 'x-setup-token': TOKEN, 'content-type': 'application/json' },
      'POST',
      JSON.stringify(body),
    );
  const WINDOW = { from: '2026-09-01', to: '2026-10-01' };
  let calls: string[][];

  beforeEach(async () => {
    calls = [];
    await server.close();
    server = await startUiServer({
      staticDir,
      token: TOKEN,
      runCli: (args) => {
        calls.push(args);
        if (args[1] === 'report')
          return Promise.resolve({ code: 0, stdout: JSON.stringify(ROWS), stderr: '' });
        if (args[0] === 'analyse') {
          return Promise.resolve({
            code: 0,
            stdout: '',
            stderr:
              '✓ Found 2 themes in 7 ratings\n  3  wrong answer  Sample\n  2  slow  Sample\n… Writing the themes\n✓ Wrote\nFile written\n  themes  /tmp/out/themes.xlsx\n',
          });
        }
        return Promise.resolve({
          code: 0,
          stdout: '',
          stderr:
            '✓ 7 of 9 ratings selected (3 positive, 4 negative)\nFiles written\n  negative  /tmp/out/n.csv\n  positive  /tmp/out/p.csv\n',
        });
      },
    });
    port = Number(new URL(server.url).port);
  });

  it('should return one page of rows and the total when rows are asked for', async () => {
    const reply = await post('/api/rows', { ...WINDOW, page: 1, pageSize: 3 });

    const body = JSON.parse(reply.body);
    expect([body.total, body.rows.length, body.rows[0].question]).toEqual([7, 3, 'question 03']);
  });

  it('should sort every row before it takes the page when a column is chosen', async () => {
    const reply = await post('/api/rows', {
      ...WINDOW,
      pageSize: 2,
      sortBy: 'question',
      sortDir: 'desc',
    });

    expect(JSON.parse(reply.body).rows.map((row: { question: string }) => row.question)).toEqual([
      'question 06',
      'question 05',
    ]);
  });

  it('should run the CLI once and serve the next page from memory when the same window is asked again', async () => {
    await post('/api/rows', { ...WINDOW, page: 0, pageSize: 3 });
    await post('/api/rows', { ...WINDOW, page: 1, pageSize: 3 });

    expect(calls.filter((args) => args[1] === 'report')).toHaveLength(1);
  });

  it('should return at most 200 rows when a page size is far larger than the limit', async () => {
    await server.close();
    const many = Array.from({ length: 250 }, (_, index) => ({ question: `q${index}` }));
    server = await startUiServer({
      staticDir,
      token: TOKEN,
      runCli: () => Promise.resolve({ code: 0, stdout: JSON.stringify(many), stderr: '' }),
    });
    port = Number(new URL(server.url).port);

    const body = JSON.parse((await post('/api/rows', { ...WINDOW, pageSize: 100000 })).body);

    expect([body.total, body.rows.length]).toEqual([250, 200]);
  });

  it('should return one row when the page size is below one', async () => {
    const body = JSON.parse((await post('/api/rows', { ...WINDOW, pageSize: -5 })).body);

    expect(body.rows.length).toBe(1);
  });

  it('should refuse a backwards window and run nothing when rows are asked for', async () => {
    const reply = await post('/api/rows', { from: '2026-10-01', to: '2026-09-01' });

    expect([reply.status, calls]).toEqual([400, []]);
  });

  it('should return the written files and the counts when an export succeeds', async () => {
    const reply = await post('/api/export', { ...WINDOW, format: 'csv' });

    expect(JSON.parse(reply.body)).toEqual({
      ok: true,
      message: '',
      selected: 7,
      found: 9,
      files: [
        { kind: 'negative', path: '/tmp/out/n.csv' },
        { kind: 'positive', path: '/tmp/out/p.csv' },
      ],
    });
  });

  it('should refuse an unknown format and run nothing when an export is asked for', async () => {
    const reply = await post('/api/export', { ...WINDOW, format: 'xml' });

    expect([reply.status, calls]).toEqual([400, []]);
  });

  it('should return the themes and the file when analyse succeeds', async () => {
    const reply = await post('/api/analyse', WINDOW);

    expect(JSON.parse(reply.body)).toEqual({
      ok: true,
      message: '',
      themes: ['✓ Found 2 themes in 7 ratings', '  3  wrong answer  Sample', '  2  slow  Sample'],
      files: [{ kind: 'themes', path: '/tmp/out/themes.xlsx' }],
    });
  });

  it('should never send a masking flag to the CLI when rows, export and analyse are asked for', async () => {
    await post('/api/rows', WINDOW);
    await post('/api/export', { ...WINDOW, yes: true });
    await post('/api/analyse', { ...WINDOW, yes: true, noMask: true, '--no-mask': true });

    expect(calls.flat().some((arg) => arg.includes('mask'))).toBe(false);
  });

  it('should answer 401 when a report route is called without the token', async () => {
    const reply = await get(
      '/api/export',
      { 'content-type': 'application/json' },
      'POST',
      JSON.stringify(WINDOW),
    );

    expect(reply.status).toBe(401);
  });
});

describe('report output readers', () => {
  it('should keep the last lines and drop the banner box when a failure is explained', () => {
    const stderr =
      '… Applying filter\nInvalid filter\nrating = nonsense\n         ^ "nonsense" is not a valid rating.\n';

    expect(cliProblem({ code: 1, stdout: '', stderr })).toBe(
      'Invalid filter rating = nonsense ^ "nonsense" is not a valid rating.',
    );
  });

  it('should show the warning line first and skip the progress lines when a run stops with a warning', () => {
    const stderr =
      '✓ Fetched 3 conversations\n✓ Built 3 rows\n! No model is set up. Run: config set llm.provider\n';

    expect(cliProblem({ code: 1, stdout: '', stderr })).toBe(
      '! No model is set up. Run: config set llm.provider',
    );
  });

  it('should find no files when the CLI wrote none', () => {
    expect(writtenFiles('✓ 0 of 0 ratings selected\n')).toEqual([]);
  });

  it('should find no themes when the CLI did not report any', () => {
    expect(themeLines('! Nothing to analyse\n')).toEqual([]);
  });
});

describe('ui server docs route', () => {
  const docs = (query: string) => get(`/api/docs${query}`, { 'x-setup-token': TOKEN });

  it('should list the bundled pages when no page or question is given', async () => {
    const body = JSON.parse((await docs('')).body);

    expect(body.pages.map((page: { name: string }) => page.name)).toEqual([
      'langfuse-setup',
      'bring-your-own-schema',
      'with-eval-dashboards',
      'agent-setup',
      'readme',
      'config-reference',
    ]);
  });

  it('should return the text of one page when its name is given', async () => {
    const body = JSON.parse((await docs('?page=langfuse-setup')).body);

    expect([body.ok, body.text.includes('chat-turn')]).toEqual([true, true]);
  });

  it('should answer 404 and name no file when the page does not exist', async () => {
    const reply = await docs('?page=..%2f..%2fpackage.json');

    expect([reply.status, reply.body.includes('"ok":false')]).toEqual([404, true]);
  });

  it('should return ranked sections when a question is asked', async () => {
    const body = JSON.parse((await docs('?q=how%20do%20I%20connect%20LiteLLM')).body);

    expect(body.results.some((hit: { text: string }) => /litellm/i.test(hit.text))).toBe(true);
  });

  it('should return no results when the words are not in any page', async () => {
    const body = JSON.parse((await docs('?q=zzzqqq%20xqxqxq')).body);

    expect(body.results).toEqual([]);
  });

  it('should refuse a question over 300 characters', async () => {
    expect((await docs(`?q=${'a'.repeat(301)}`)).status).toBe(400);
  });

  it('should answer 401 when the docs are asked for without the token', async () => {
    expect((await get('/api/docs')).status).toBe(401);
  });
});

describe('content security policy', () => {
  const directive = (name: string): string =>
    CONTENT_SECURITY_POLICY.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? '';

  it('should keep scripts, connections and everything not named limited to the page itself', () => {
    expect([directive('default-src'), CONTENT_SECURITY_POLICY.includes('script-src')]).toEqual([
      "default-src 'self'",
      false,
    ]);
  });

  it('should allow pictures from the page and from inline data and no remote picture', () => {
    expect(directive('img-src')).toBe("img-src 'self' data:");
  });

  it('should allow inline styles only in the style directive', () => {
    expect([
      directive('style-src').includes("'unsafe-inline'"),
      directive('default-src').includes('unsafe'),
    ]).toEqual([true, false]);
  });

  it('should never let a page be framed or allow eval or an outside host', () => {
    expect([
      directive('frame-ancestors'),
      /unsafe-eval|https?:|\*/.test(CONTENT_SECURITY_POLICY),
    ]).toEqual(["frame-ancestors 'none'", false]);
  });

  it('should send the same policy on a served page', async () => {
    const headers = await new Promise<Record<string, unknown>>((resolve) => {
      request({ host: '127.0.0.1', port, path: `/?token=${TOKEN}` }, (r) =>
        resolve(r.headers),
      ).end();
    });

    expect(headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  });

  it('should send the framing and referrer headers on a served page when the page is requested', async () => {
    const headers = await new Promise<Record<string, unknown>>((resolve) => {
      request({ host: '127.0.0.1', port, path: `/?token=${TOKEN}` }, (r) =>
        resolve(r.headers),
      ).end();
    });

    expect([headers['x-frame-options'], headers['referrer-policy']]).toEqual([
      'DENY',
      'no-referrer',
    ]);
  });
});

describe('ui server docs page kinds', () => {
  const docs = (query: string) => get(`/api/docs${query}`, { 'x-setup-token': TOKEN });

  it('should mark the settings reference as plain text and every other page as markdown when the pages are listed', async () => {
    const body = JSON.parse((await docs('')).body);

    expect(
      Object.fromEntries(
        body.pages.map((page: { name: string; kind: string }) => [page.name, page.kind]),
      ),
    ).toEqual({
      'langfuse-setup': 'markdown',
      'bring-your-own-schema': 'markdown',
      'with-eval-dashboards': 'markdown',
      'agent-setup': 'markdown',
      readme: 'markdown',
      'config-reference': 'text',
    });
  });

  it('should carry the kind with the page text and with a search hit', async () => {
    const page = JSON.parse((await docs('?page=config-reference')).body);
    const hit = JSON.parse(
      (await docs('?q=activeProfile%20outDir%20conventions')).body,
    ).results.find((each: { page: string }) => each.page === 'config-reference');

    expect([page.kind, hit?.kind]).toEqual(['text', 'text']);
  });
});

describe('ui server when the command queue is full', () => {
  it('should answer 503 with a retry hint when the runner refuses a command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-busy-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    const busy = await startUiServer({
      staticDir: dir,
      token: TOKEN,
      runCli: () => Promise.reject(new QueueFullError()),
    });
    const busyPort = Number(new URL(busy.url).port);

    const reply = await new Promise<{ status: number; retry: unknown }>((resolve) => {
      request(
        {
          host: '127.0.0.1',
          port: busyPort,
          path: '/api/settings',
          headers: { 'x-setup-token': TOKEN },
        },
        (r) => {
          r.resume();
          r.on('end', () =>
            resolve({ status: r.statusCode ?? 0, retry: r.headers['retry-after'] }),
          );
        },
      ).end();
    });
    await busy.close();

    expect(reply).toEqual({ status: 503, retry: '2' });
  });
});
