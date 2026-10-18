import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, normalize, sep } from 'node:path';
import { SETTABLE_KEYS } from '../config/config-schema.js';
import { loadDocPages, searchSections, splitSections, type DocPage } from '../docs/docs-library.js';
import { analyseArgs, checkReportRequest, exportArgs, rowsArgs } from './report-args.js';
import { stripAnsi } from '../ui/ansi.js';
import { QueueFullError } from './limit-concurrency.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the jeves CLI with these arguments in a child process. A test supplies a fake. */
export type CliRunner = (args: string[]) => Promise<CliResult>;

const MAX_BODY_BYTES = 8_192;
const MAX_ENTRIES = 500;

export interface UiServerOptions {
  /** Folder holding the built page. */
  staticDir: string;
  runCli: CliRunner;
  /** Where the file browser starts; the home folder when absent. */
  browseStart?: string;
  /** Fixed token for tests; a random one is made when absent. */
  token?: string;
}

export interface RunningUiServer {
  url: string;
  token: string;
  close: () => Promise<void>;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Only an address on this computer is allowed, so a web page cannot reach the server by a rebound name. */
export function isLocalHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const allowed = [...LOCAL_HOSTS].map((host) => `${host}:${port}`);
  return allowed.includes(hostHeader.toLowerCase());
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scripts, fonts, connections and frames stay limited to the page's own files. Two things are opened
 * on purpose: pictures drawn from inline data (the diagrams in the docs are drawn that way, and a data
 * picture cannot run code), and inline styles (the diagram drawer sets them). Remote pictures stay blocked.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...extra,
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': CONTENT_SECURITY_POLICY,
  });
  response.end(body);
}

const COOKIE_NAME = 'setup_token';

function cookieToken(request: IncomingMessage): string | undefined {
  const cookies = String(request.headers.cookie ?? '').split(';');
  const mine = cookies
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return mine?.slice(COOKIE_NAME.length + 1);
}

/** The token from the header, the address, or the cookie the first page load set. */
function tokenFrom(request: IncomingMessage, url: URL): string | undefined {
  const header = request.headers['x-setup-token'];
  return (
    (Array.isArray(header) ? header[0] : header) ??
    url.searchParams.get('token') ??
    cookieToken(request)
  );
}

/** The file inside `staticDir` that a request path names, or undefined when it leaves the folder or is not a page file type. */
export function resolveStaticPath(staticDir: string, pathname: string): string | undefined {
  const wanted = pathname === '/' ? '/index.html' : pathname;
  const file = normalize(join(staticDir, wanted));
  const inside = file.startsWith(staticDir + sep);
  return inside && CONTENT_TYPES[extname(file)] ? file : undefined;
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  response: ServerResponse,
  token: string,
): Promise<void> {
  const file = resolveStaticPath(staticDir, pathname);
  if (!file) return send(response, 404, 'text/plain', 'Not found');
  const isPage = extname(file) === '.html';
  const cookie = { 'set-cookie': `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/` };
  try {
    send(
      response,
      200,
      CONTENT_TYPES[extname(file)] ?? 'text/plain',
      await readFile(file),
      isPage ? cookie : {},
    );
  } catch {
    send(response, 404, 'text/plain', 'Not found');
  }
}

const MAX_QUESTION_LENGTH = 300;
const DOC_PAGE_TITLES: Record<string, string> = {
  readme: 'README',
  'langfuse-setup': 'How Langfuse must be set up',
  'bring-your-own-schema': 'Use your own Langfuse names',
  'with-eval-dashboards': 'Using it with eval-dashboards: when to use which',
  'agent-setup': 'Procedure for a coding agent',
  'config-reference': 'Every setting',
};

/** Pages that are not markdown are shown as they are, in a text block. The settings reference is a JSON file with // comments. */
const DOC_PAGE_KINDS: Record<string, 'markdown' | 'text'> = { 'config-reference': 'text' };
const kindOf = (name: string): 'markdown' | 'text' => DOC_PAGE_KINDS[name] ?? 'markdown';

/** The bundled pages, loaded once. The page and the `docs` command read the same files. */
let docPages: Promise<DocPage[]> | undefined;
function pages(): Promise<DocPage[]> {
  docPages ??= loadDocPages();
  return docPages;
}

/** The list of pages for the Docs tab, and one page's sections, or the best sections for a question. */
async function handleDocs(response: ServerResponse, url: URL): Promise<void> {
  const loaded = await pages();
  const page = url.searchParams.get('page');
  const question = (url.searchParams.get('q') ?? '').trim();
  if (question.length > MAX_QUESTION_LENGTH)
    return sendJson(response, { ok: false, message: 'The question is too long' }, 400);
  if (question !== '') {
    const sections = loaded.flatMap((each) => splitSections(each));
    return sendJson(response, {
      ok: true,
      results: searchSections(sections, question, 5).map((section) => ({
        page: section.page,
        title: DOC_PAGE_TITLES[section.page] ?? section.page,
        kind: kindOf(section.page),
        heading: section.heading,
        text: section.text,
      })),
    });
  }
  if (page !== null) {
    const found = loaded.find((each) => each.name === page);
    if (!found) return sendJson(response, { ok: false, message: 'There is no such page' }, 404);
    return sendJson(response, {
      ok: true,
      page: found.name,
      title: DOC_PAGE_TITLES[found.name] ?? found.name,
      kind: kindOf(found.name),
      text: found.text,
    });
  }
  sendJson(response, {
    ok: true,
    pages: loaded.map((each) => ({
      name: each.name,
      kind: kindOf(each.name),
      title: DOC_PAGE_TITLES[each.name] ?? each.name,
    })),
  });
}

/** 503 with a retry hint when the page is asking for more than it may run at once; 502 for any other failure. */
function sendRunFailure(response: ServerResponse, err: unknown): void {
  if (err instanceof QueueFullError) {
    send(response, 503, 'text/plain', 'Too many requests at once. Try again in a moment.', {
      'retry-after': '2',
    });
    return;
  }
  send(response, 502, 'text/plain', 'The command could not run');
}

/** A CLI command whose stdout is JSON. The exit code is not an error here: 1 is a normal "problems found". */
async function sendCliJson(
  response: ServerResponse,
  runCli: CliRunner,
  args: string[],
): Promise<void> {
  try {
    const result = await runCli(args);
    JSON.parse(result.stdout);
    send(response, 200, 'application/json; charset=utf-8', result.stdout);
  } catch (err) {
    sendRunFailure(response, err);
  }
}

interface BrowseEntry {
  name: string;
  kind: 'dir' | 'file';
}

/** Lists names only. It never opens a file, so it cannot read a key. */
async function handleBrowse(response: ServerResponse, url: URL, start: string): Promise<void> {
  const wanted = url.searchParams.get('path') || start;
  const showHidden = url.searchParams.get('hidden') === '1';
  if (!isAbsolute(wanted)) return send(response, 400, 'text/plain', 'The path must be absolute');
  try {
    const folder = await realpath(wanted);
    const names = await readdir(folder, { withFileTypes: true });
    const entries: BrowseEntry[] = [];
    for (const entry of names) {
      if (!showHidden && entry.name.startsWith('.')) continue;
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() && (await isDirectory(join(folder, entry.name))));
      entries.push({ name: entry.name, kind: isDir ? 'dir' : 'file' });
    }
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    );
    const body = {
      path: folder,
      parent: dirname(folder) === folder ? null : dirname(folder),
      entries: entries.slice(0, MAX_ENTRIES),
      truncated: entries.length > MAX_ENTRIES,
    };
    send(response, 200, 'application/json; charset=utf-8', JSON.stringify(body));
  } catch {
    send(response, 404, 'text/plain', 'That folder cannot be listed');
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_BYTES) {
        request.destroy();
        resolve(undefined);
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', () => resolve(undefined));
  });
}

/** The line the CLI printed about the setting itself, without the banner box that follows it. */
export function settingMessage(result: CliResult): string {
  const marks = ['✓', '✗', '!', 'Invalid'];
  const lines = stripAnsi(result.stderr || result.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => marks.some((mark) => line.startsWith(mark)));
  const last = lines.at(-1) ?? '';
  return last.replace(/^[✓✗!]\s*/, '').replace(/^Setting [\w.]+:\s*/, '');
}

const REPORT_CACHE_MS = 5 * 60_000;
const MAX_PAGE_SIZE = 200;
const MAX_ROWS_KEPT = 20_000;

type ReportRow = Record<string, unknown>;

interface CachedRows {
  key: string;
  at: number;
  rows: ReportRow[];
}

/** The last few meaningful lines the CLI printed, for showing why a request failed. */
export function cliProblem(result: CliResult): string {
  const lines = stripAnsi(result.stderr || result.stdout)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !/^[╭│╰┌└]/.test(line.trim()) && !line.startsWith('…'));
  const firstWarning = lines.findIndex((line) => /^(!|✗|Invalid)/.test(line.trim()));
  return (firstWarning >= 0 ? lines.slice(firstWarning) : lines)
    .slice(-3)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 400);
}

/** Paths the CLI printed under "File written" / "Files written", as `kind  path` lines. */
export function writtenFiles(stderr: string): Array<{ kind: string; path: string }> {
  const files: Array<{ kind: string; path: string }> = [];
  for (const line of stripAnsi(stderr).split('\n')) {
    const found = /^\s{2}(\w+)\s{2,}(\/\S.*)$/.exec(line);
    if (found?.[1] && found[2]) files.push({ kind: found[1], path: found[2].trim() });
  }
  return files;
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function pageOf(rows: ReportRow[], body: Record<string, unknown>): ReportRow[] {
  const size = Math.min(Math.max(Number(body.pageSize) || 25, 1), MAX_PAGE_SIZE);
  const page = Math.max(Number(body.page) || 0, 0);
  const sortBy = typeof body.sortBy === 'string' ? body.sortBy : '';
  const direction = body.sortDir === 'desc' ? -1 : 1;
  const sorted =
    sortBy !== '' && rows[0] !== undefined && sortBy in rows[0]
      ? [...rows].sort(
          (a, b) =>
            direction *
            String(a[sortBy] ?? '').localeCompare(String(b[sortBy] ?? ''), undefined, {
              numeric: true,
            }),
        )
      : rows;
  return sorted.slice(page * size, page * size + size);
}

interface PostContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  runCli: CliRunner;
  port: number;
  cache: { last: CachedRows | undefined };
}

/** The only write: one setting, saved by `jeves config set`, so the CLI's zod rules check it first. */
async function handleConfigSet(context: PostContext, body: unknown): Promise<void> {
  const { response, runCli } = context;
  const { key, value } = (body ?? {}) as { key?: unknown; value?: unknown };
  const known: readonly string[] = SETTABLE_KEYS;
  if (
    typeof key !== 'string' ||
    !known.includes(key) ||
    typeof value !== 'string' ||
    value.startsWith('-')
  ) {
    return send(response, 400, 'text/plain', 'Not a setting this page may change');
  }
  const result = await runCli(['config', 'set', key, value]);
  sendJson(response, { ok: result.code === 0, message: settingMessage(result) });
}

async function handleRows(context: PostContext, body: unknown): Promise<void> {
  const { response, runCli, cache } = context;
  const checked = checkReportRequest(body);
  if (!checked.ok) return sendJson(response, { ok: false, message: checked.message }, 400);
  const key = JSON.stringify(rowsArgs(checked.value));
  if (!cache.last || cache.last.key !== key || Date.now() - cache.last.at > REPORT_CACHE_MS) {
    const result = await runCli(rowsArgs(checked.value));
    if (result.code !== 0) return sendJson(response, { ok: false, message: cliProblem(result) });
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return sendJson(response, { ok: false, message: 'The report could not be read' });
    }
    if (!Array.isArray(parsed))
      return sendJson(response, { ok: false, message: 'The report could not be read' });
    cache.last = { key, at: Date.now(), rows: (parsed as ReportRow[]).slice(0, MAX_ROWS_KEPT) };
  }
  const { rows } = cache.last;
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  sendJson(response, {
    ok: true,
    total: rows.length,
    columns,
    rows: pageOf(rows, (body ?? {}) as Record<string, unknown>),
  });
}

async function handleExport(context: PostContext, body: unknown): Promise<void> {
  const { response, runCli } = context;
  const checked = checkReportRequest(body);
  if (!checked.ok) return sendJson(response, { ok: false, message: checked.message }, 400);
  const result = await runCli(exportArgs(checked.value));
  const text = stripAnsi(result.stderr);
  const selected = /(\d+) of (\d+) ratings selected/.exec(text);
  sendJson(response, {
    ok: result.code === 0,
    message: result.code === 0 ? '' : cliProblem(result),
    selected: selected ? Number(selected[1]) : undefined,
    found: selected ? Number(selected[2]) : undefined,
    files: result.code === 0 ? writtenFiles(result.stderr) : [],
  });
}

/** The themes block the CLI printed, one line each, so the page can show it without parsing a table. */
export function themeLines(stderr: string): string[] {
  const lines = stripAnsi(stderr).split('\n');
  const start = lines.findIndex((line) => /^✓ Found \d+ themes/.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith('…'));
  return lines
    .slice(start, end < 0 ? undefined : end)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}

async function handleAnalyse(context: PostContext, body: unknown): Promise<void> {
  const { response, runCli } = context;
  const checked = checkReportRequest(body);
  if (!checked.ok) return sendJson(response, { ok: false, message: checked.message }, 400);
  const result = await runCli(analyseArgs(checked.value));
  sendJson(response, {
    ok: result.code === 0,
    message: result.code === 0 ? '' : cliProblem(result),
    themes: result.code === 0 ? themeLines(result.stderr) : [],
    files: result.code === 0 ? writtenFiles(result.stderr) : [],
  });
}

const POST_ROUTES: Record<string, (context: PostContext, body: unknown) => Promise<void>> = {
  '/api/config-set': handleConfigSet,
  '/api/rows': handleRows,
  '/api/export': handleExport,
  '/api/analyse': handleAnalyse,
};

/** The writes and runs the page may ask for. Each route checks its own body before the CLI sees any of it. */
async function handlePost(context: PostContext): Promise<void> {
  const { request, response, url, port } = context;
  const origin = request.headers.origin;
  const sameOrigin =
    origin === undefined ||
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`;
  const isJson = String(request.headers['content-type'] ?? '').startsWith('application/json');
  const route = POST_ROUTES[url.pathname];
  if (!route) return send(response, 404, 'text/plain', 'Not found');
  if (!sameOrigin || !isJson) return send(response, 400, 'text/plain', 'Bad request');
  const text = await readBody(request);
  let body: unknown;
  try {
    body = JSON.parse(text ?? '');
  } catch {
    return send(response, 400, 'text/plain', 'Bad request');
  }
  try {
    await route(context, body);
  } catch (err) {
    sendRunFailure(response, err);
  }
}

/** Starts the setup page server on 127.0.0.1. It reads no env file, lists names only, and can change only the settings the CLI allows. */
export async function startUiServer(options: UiServerOptions): Promise<RunningUiServer> {
  const token = options.token ?? randomBytes(24).toString('hex');
  const staticDir = normalize(options.staticDir);
  let port = 0;
  const cache: { last: CachedRows | undefined } = { last: undefined };

  /** Everything a request can meet, in order: method, host, token, then the route. Any throw is caught by the caller. */
  const routeRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const isGet = request.method === 'GET';
    const isPost = request.method === 'POST';
    if (!isGet && !isPost) return send(response, 405, 'text/plain', 'Method not allowed');
    if (!isLocalHost(request.headers.host, port)) {
      return send(response, 403, 'text/plain', 'Forbidden host');
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (!sameToken(tokenFrom(request, url), token)) {
      return send(response, 401, 'text/plain', 'Missing or wrong token');
    }
    if (isPost) return handlePost({ request, response, url, runCli: options.runCli, port, cache });
    if (url.pathname === '/api/doctor') {
      return sendCliJson(response, options.runCli, ['doctor', '--json']);
    }
    if (url.pathname === '/api/docs') return handleDocs(response, url);
    if (url.pathname === '/api/settings') {
      return sendCliJson(response, options.runCli, ['config', 'show', '--json']);
    }
    if (url.pathname === '/api/discover') {
      return sendCliJson(response, options.runCli, ['config', 'discover']);
    }
    if (url.pathname === '/api/browse') {
      return handleBrowse(response, url, options.browseStart ?? homedir());
    }
    await serveStatic(staticDir, url.pathname, response, token);
  };

  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        await routeRequest(request, response);
      } catch {
        if (!response.headersSent) send(response, 500, 'text/plain', 'Something went wrong');
        else response.end();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
