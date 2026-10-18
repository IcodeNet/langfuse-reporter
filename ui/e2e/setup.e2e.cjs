/**
 * Click-through of the guided setup in a real browser, against a fake Langfuse and a real `jeves ui`.
 * Run: pnpm e2e:ui   (needs the page built with pnpm build:ui, and CHROME_PATH or a Playwright Chromium)
 */
const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jeves-e2e-'));
const FAKE_PORT = '8831';
const CHROME =
  process.env.CHROME_PATH ||
  (() => {
    try {
      return chromium.executablePath();
    } catch {
      return undefined;
    }
  })();

fs.writeFileSync(
  path.join(T, 'keys.env'),
  'LANGFUSE_PUBLIC_KEY=pk-lf-SECRETMARKER111\nLANGFUSE_SECRET_KEY=sk-lf-SECRETMARKER222\n',
);
fs.writeFileSync(
  path.join(T, 'c.json'),
  JSON.stringify({
    activeProfile: 'dev',
    outDir: path.join(T, 'reports-out'),
    profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
  }),
);

const running = [];

/** Kills each started server with its whole process group, so no inner node process is left behind. */
function stopAll() {
  for (const child of running.splice(0)) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

function startFake() {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'fake-langfuse.mjs'), FAKE_PORT, 'assistant-turn', 'thumbs', 'why.'],
    { stdio: 'ignore', detached: true },
  );
  running.push(child);
  return child;
}

function startUi() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(ROOT, 'node_modules/.bin/tsx'),
      ['src/index.ts', '--config', path.join(T, 'c.json'), 'ui', '--no-open'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    running.push(child);
    let out = '';
    const timer = setTimeout(
      () => reject(new Error('jeves ui did not print a link in 20s')),
      20000,
    );
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const link = out.split('\n').find((line) => line.startsWith('http://'));
      if (link) {
        clearTimeout(timer);
        resolve({ child, url: link.trim() });
      }
    });
    child.on('error', reject);
  });
}

const cfg = () => JSON.parse(fs.readFileSync(T + '/c.json', 'utf8'));
const log = [];
const ok = (n, c, d = '') => {
  log.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' | ' + d : ''));
};
setTimeout(() => {
  console.log('The click-through ran longer than 5 minutes and was stopped.');
  process.exit(1);
}, 300_000).unref();
(async () => {
  const fake = startFake();
  await new Promise((r) => setTimeout(r, 700));
  const { child: ui, url } = await startUi();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 1200 } });
  const errors = [];
  p.on('response', (r) => {
    if (r.status() >= 400)
      errors.push(
        'HTTP ' +
          r.status() +
          ' ' +
          r.request().method() +
          ' ' +
          r.url().replace(/token=\w+/, 'token=<t>'),
      );
  });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.goto(url);
  await p.waitForSelector('text=Which Langfuse do you use?');
  ok('page 1 shows the question', true);
  await p.screenshot({ path: T + '/p1.png' });
  // page 1: a self-hosted Langfuse on this computer is its own option
  await p.waitForSelector('text=Langfuse on this computer');
  await p.click('button[role=radio]:has-text("Langfuse on this computer")');
  await p.waitForSelector('text=Address on this computer');
  await p.waitForFunction(() => true);
  const savedLocal = await (async () => {
    for (let i = 0; i < 20; i++) {
      const v = cfg().profiles.dev.baseUrl;
      if (v === 'http://localhost:3000') return v;
      await p.waitForTimeout(250);
    }
    return cfg().profiles.dev.baseUrl;
  })();
  ok(
    'page 1 offers Langfuse on this computer and saves the default local address',
    savedLocal === 'http://localhost:3000',
    savedLocal,
  );
  ok(
    'page 1 local field shows the default address',
    (await p.inputValue('#profile\\.baseUrl')) === 'http://localhost:3000',
    await p.inputValue('#profile\\.baseUrl'),
  );
  await p.fill('#profile\\.baseUrl', 'http://localhost:3300');
  await p.click('button:has-text("Save")');
  await p.waitForSelector('.field .ok-text');
  ok(
    'page 1 saves a changed local port',
    cfg().profiles.dev.baseUrl === 'http://localhost:3300',
    cfg().profiles.dev.baseUrl,
  );
  await p.fill('#profile\\.baseUrl', 'localhost:3000');
  await p.click('button:has-text("Save")');
  await p.waitForSelector('.field .error');
  ok(
    'page 1 refuses a local address without http://',
    /http/.test(await p.textContent('.field .error')) &&
      cfg().profiles.dev.baseUrl === 'http://localhost:3300',
    (await p.textContent('.field .error')).slice(0, 90),
  );
  await p.screenshot({ path: T + '/p1-local.png' });
  // page 1: choose "My own address", type the fake server address, save
  await p.click('button[role=radio]:has-text("Another address")');
  await p.fill('#profile\\.baseUrl', 'http://127.0.0.1:8831');
  await p.click('button:has-text("Save")');
  await p.waitForSelector('text=✓ Saved');
  ok(
    'page 1 saved address to the config file',
    cfg().profiles.dev.baseUrl === 'http://127.0.0.1:8831',
    cfg().profiles.dev.baseUrl,
  );
  // a bad value is refused with the CLI reason and the file is unchanged
  await p.fill('#profile\\.baseUrl', 'not a url');
  await p.click('button:has-text("Save")');
  await p.waitForSelector('.error');
  const err = await p.textContent('.error');
  ok(
    'page 1 refuses a bad address with a reason',
    /Invalid|url|address/i.test(err),
    err.slice(0, 90),
  );
  ok(
    'refused save left the file unchanged',
    cfg().profiles.dev.baseUrl === 'http://127.0.0.1:8831',
  );
  await p.click('button:text-is("Next")');
  // page 2: pick env file through the browser
  await p.waitForSelector('text=Where are your keys?');
  await p.screenshot({ path: T + '/p2.png' });
  await p.click('button:has-text("Choose the env file")');
  await p.waitForSelector('.picker');
  // navigate to the folder holding keys.env
  const target = T;
  const base = await p.textContent('.path');
  ok('file picker opened with a path', base.startsWith('/'), base);
  // type the folder path, as a user with a key file in a hidden folder would
  await p.fill('input[aria-label="Type a folder path"]', target);
  await p.click('button:has-text("Go")');
  await p.waitForSelector('.entry:has-text("keys.env")');
  await p.click('.picker input[type=checkbox]');
  await p.waitForTimeout(300);
  const hiddenShown = (await p.$$eval('.entry', (els) => els.map((x) => x.textContent))).length;
  await p.screenshot({ path: T + '/p2-picker.png' });
  const names = await p.$$eval('.entry', (els) => els.map((e) => e.textContent));
  ok(
    'picker lists keys.env by name',
    names.some((n) => n.includes('keys.env')),
    names.join(' | '),
  );
  await p.click('.entry:has-text("keys.env")');
  await p.waitForSelector('text=Keys');
  await p.waitForSelector('.check.ok');
  ok(
    'page 2 saved the env file path',
    cfg().profiles.dev.envFile === T + '/keys.env',
    String(cfg().profiles.dev.envFile),
  );
  const keysText = await p.textContent('.checks');
  ok(
    'page 2 shows keys found, no key value',
    /found/.test(keysText) && !/SECRETMARKER/.test(await p.content()),
    keysText.replace(/\s+/g, ' ').slice(0, 120),
  );
  await p.screenshot({ path: T + '/p2-done.png' });
  await p.click('button:text-is("Next")');
  // page 3
  await p.waitForSelector('text=Which project did your keys open?');
  await p.click('button:has-text("Ask Langfuse")');
  await p.waitForSelector('.project');
  const proj = await p.textContent('.project');
  ok('page 3 shows the project name', proj.includes('Customer Chat'), proj.trim());
  await p.screenshot({ path: T + '/p3.png' });
  await p.click('button:text-is("Next")');
  // page 4: names, defaults are wrong for this fake app
  await p.waitForSelector('text=What do you call your turns');
  await p.waitForSelector('.chips .chip');
  await p.screenshot({ path: T + '/p4-before.png' });
  const warn = await p.textContent('.checks');
  ok(
    'page 4 warns the defaults do not match',
    /No observation is called "chat-turn"/.test(warn) &&
      /No score is called "feedback_helpful"/.test(warn),
    warn.replace(/\s+/g, ' ').slice(0, 160),
  );
  await p.click('.chip:has-text("assistant-turn")');
  await p.waitForSelector('text=✓ Saved assistant-turn');
  ok(
    'page 4 turn name saved',
    cfg().conventions?.turnName === 'assistant-turn',
    JSON.stringify(cfg().conventions),
  );
  await p.click('.chip:text-is("thumbs")');
  await p.waitForSelector('text=✓ Saved thumbs');
  ok('page 4 rating score saved', cfg().conventions?.ratingScore === 'thumbs');
  await p.fill('#conventions\\.reasonScorePrefix', 'why.');
  await p.click('.field button:has-text("Save")');
  await p.waitForSelector('.field .ok-text');
  ok('page 4 prefix saved', cfg().conventions?.reasonScorePrefix === 'why.');
  await p.waitForSelector('text=Turns are called "assistant-turn"');
  const good = await p.textContent('.checks');
  ok(
    'page 4 now shows both ticks',
    /Turns are called "assistant-turn"/.test(good) && /The thumb score "thumbs" exists/.test(good),
    good.replace(/\s+/g, ' ').slice(0, 200),
  );
  await p.screenshot({ path: T + '/p4-after.png' });
  await p.click('button:text-is("Next")');
  // page 5 model
  await p.waitForSelector('text=Do you want a model?');
  await p.click('.chip:has-text("litellm")');
  await p.waitForSelector('text=✓ Saved litellm');
  ok('page 5 provider saved', cfg().llm?.provider === 'litellm');
  await p.screenshot({ path: T + '/p5.png' });
  await p.click('button:has-text("Skip or continue")');
  // page 6 and the doctor
  await p.waitForSelector('text=That is the setup');
  await p.click('button:has-text("Run the full check")');
  await p.waitForSelector('text=Check everything');
  await p.waitForSelector('.check');
  const rat = await p.textContent('.checks');
  ok(
    'doctor sees ratings on a chat turn after the wizard',
    /Ratings[\s\S]*3 on a chat turn/.test(rat),
    rat
      .replace(/\s+/g, ' ')
      .slice(rat.indexOf('Ratings') > 0 ? rat.replace(/\s+/g, ' ').indexOf('Ratings') : 0, 200),
  );
  await p.screenshot({ path: T + '/p6-doctor.png' });

  // ---- Reports tab: window, filter, grid, sort, paging, exports on disk, analyse
  const outDir = T + '/reports-out';
  await p.click('button.tab:has-text("Reports")');
  await p.waitForSelector('h2:text-is("Reports")');
  await p.waitForTimeout(800);
  ok(
    'reports tab shows no setup warning when every check is green or only warns',
    (await p.$$('.confirm')).length === 0 ||
      /Setup is not complete/.test(await p.textContent('.confirm')),
  );
  await p.fill('input[aria-label="From date"]', '2026-09-01');
  await p.fill('input[aria-label="To date"]', '2026-10-01');
  const highlighted = () =>
    p.$$eval('.presets button.on', (buttons) => buttons.map((b) => b.textContent.trim()));
  ok(
    'no preset is highlighted when the dates were typed by hand to a window no preset gives',
    (await highlighted()).length === 0 || (await highlighted()).join() === 'Last month',
    (await highlighted()).join(),
  );
  await p.click('.presets button:has-text("Last 7 days")');
  ok(
    'clicking Last 7 days highlights that button and no other',
    (await highlighted()).join() === 'Last 7 days',
    (await highlighted()).join(),
  );
  ok(
    'the highlighted preset is announced as pressed',
    (await p.getAttribute('.presets button:has-text("Last 7 days")', 'aria-pressed')) === 'true',
  );
  await p.fill('input[aria-label="From date"]', '2026-09-01');
  await p.fill('input[aria-label="To date"]', '2026-10-02');
  ok('editing a date by hand clears the highlight', (await highlighted()).length === 0);
  await p.fill('input[aria-label="To date"]', '2026-10-01');
  await p.click('button:has-text("Show the ratings")');
  await p.waitForSelector('table.grid');
  const total = await p.textContent('.summary');
  ok('grid shows the matching ratings', /3 ratings match/.test(total), total.trim());
  const heads = await p.$$eval('table.grid th', (e) => e.map((x) => x.textContent.trim()));
  ok(
    'grid has the expected columns',
    ['created', 'rating', 'question', 'answer'].every((c) => heads.some((h) => h.startsWith(c))),
    heads.join(','),
  );
  ok('grid shows each rating on its own row', (await p.$$('table.grid tbody tr')).length === 3);
  const text = await p.textContent('table.grid');
  ok(
    'grid text has no key and no user id column',
    !/SECRETMARKER/.test(text) && !heads.includes('user'),
    '',
  );
  await p.screenshot({ path: T + '/r1-grid.png' });
  // sort by rating descending: click twice
  await p.click('button.th:has-text("rating")');
  await p.waitForTimeout(500);
  await p.click('button.th:has-text("rating")');
  await p.waitForTimeout(700);
  const order = await p.$$eval('table.grid tbody tr td:nth-child(2)', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  ok(
    'sort by rating descending puts positive first',
    order[0] === 'positive' && order.at(-1) === 'negative',
    order.join(','),
  );
  // paging
  await p.selectOption('.pager select', '10');
  await p.waitForTimeout(600);
  ok(
    'page size control keeps all rows on one page of 10',
    (await p.$$('table.grid tbody tr')).length === 3 &&
      /Page 1 of 1/.test(await p.textContent('.pager')),
  );
  ok('next page is disabled on the only page', await p.isDisabled('button:has-text("Next page")'));
  // filter
  await p.fill('#where', 'rating = negative');
  await p.click('button:has-text("Show the ratings")');
  await p.waitForFunction(() =>
    /2 ratings match/.test(document.querySelector('.summary')?.textContent || ''),
  );
  ok(
    'filter narrows the grid to the 2 negative ratings',
    (await p.$$('table.grid tbody tr')).length === 2,
  );
  await p.fill('#where', 'rating = nonsense');
  await p.click('button:has-text("Show the ratings")');
  await p.waitForSelector('.error');
  const bad = await p.textContent('.error');
  ok(
    'a bad filter is explained in plain words',
    /not a valid rating|Invalid filter/.test(bad),
    bad.slice(0, 100),
  );
  await p.fill('#where', '');
  await p.click('button:has-text("Show the ratings")');
  await p.waitForSelector('table.grid');
  // a backwards window is refused
  await p.fill('input[aria-label="From date"]', '2026-10-05');
  await p.click('button:has-text("Show the ratings")');
  await p.waitForSelector('.error');
  ok(
    'a backwards window is refused',
    /before the end date|start date/.test(await p.textContent('.error')),
    (await p.textContent('.error')).slice(0, 80),
  );
  await p.fill('input[aria-label="From date"]', '2026-09-01');
  await p.click('button:has-text("Show the ratings")');
  await p.waitForSelector('table.grid');
  // exports
  for (const [label, ext] of [
    ['CSV', 'csv'],
    ['JSON', 'json'],
    ['Excel', 'xlsx'],
  ]) {
    await p.click(`button[role=radio]:has-text("${label}")`);
    await p.click('button:has-text("Write the files")');
    await p.waitForFunction(
      (e) => {
        const c = [...document.querySelectorAll('.result .files code')].map((x) => x.textContent);
        return c.length > 0 && c.every((f) => f.endsWith('.' + e));
      },
      ext,
      { timeout: 60000 },
    );
    await p.waitForFunction(() =>
      /Wrote \d+ of \d+/.test(document.querySelector('.result')?.textContent || ''),
    );
    const listed = await p.$$eval('.result .files code', (e) => e.map((x) => x.textContent));
    const onDisk = listed.filter((f) => fs.existsSync(f) && f.endsWith('.' + ext));
    ok(
      `export ${label} wrote ${ext} files that exist on disk`,
      onDisk.length >= 1 && onDisk.length === listed.length,
      listed
        .map((f) => path.basename(f))
        .join(' | ')
        .slice(0, 160),
    );
    if (ext === 'csv') {
      const csv = fs.readFileSync(onDisk[0], 'utf8');
      ok(
        'csv file holds the ratings and no user id or key',
        /question/.test(csv) && !/SECRETMARKER/.test(csv) && !/user-\d/.test(csv),
        csv.split('\n')[0],
      );
    }
    if (ext === 'json') {
      const j = JSON.parse(fs.readFileSync(onDisk[0], 'utf8'));
      ok(
        'json file parses and has rows',
        Array.isArray(j) && j.length >= 1,
        String(j.length) + ' rows',
      );
    }
  }
  await p.screenshot({ path: T + '/r2-exported.png' });
  // analyse needs a model; with none configured it must fail in plain words, not silently
  await p.click('button:has-text("Find the common problems")');
  await p.waitForSelector('.error, .result pre', { timeout: 60000 });
  const an = (await p.$('.error')) ? await p.textContent('.error') : '(themes shown)';
  ok(
    'analyse without a working model explains what is missing',
    /model|provider|llm|LLM_API_KEY|set up/i.test(an) || an === '(themes shown)',
    an.slice(0, 140),
  );
  await p.screenshot({ path: T + '/r3-analyse.png' });
  // ---- Docs tab: list, a page, search, and the same text as `jeves docs`
  await p.click('button.tab:has-text("Docs")');
  await p.waitForSelector('h2:text-is("Documentation")');
  await p.waitForSelector('article.doc h1, article.doc h2', { timeout: 20000 });
  const pageButtons = await p.$$eval('[aria-label="Documentation pages"] button', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  ok(
    'docs tab lists the six bundled pages, including the one on using the tool with eval-dashboards',
    pageButtons.length === 6 &&
      pageButtons.includes('README') &&
      pageButtons.includes('Every setting') &&
      pageButtons.includes('Using it with eval-dashboards: when to use which'),
    pageButtons.join(' | '),
  );
  await p.click(
    '[aria-label="Documentation pages"] button:text-is("Using it with eval-dashboards: when to use which")',
  );
  await p.waitForFunction(
    () => /Use Jeves when/.test(document.querySelector('article.doc')?.textContent || ''),
    null,
    { timeout: 20000 },
  );
  const synergy = await p.textContent('article.doc');
  ok(
    'the eval-dashboards page says when to use each tool and how they work together',
    ['Use Jeves when', 'Use eval-dashboards when', 'Use them together', 'live-vs-offline'].every(
      (phrase) => synergy.includes(phrase),
    ),
  );
  ok(
    'the eval-dashboards page draws its tables as tables',
    (await p.$$('article.doc table')).length >= 2,
    String((await p.$$('article.doc table')).length),
  );
  await p.screenshot({ path: T + '/d1-synergy.png', fullPage: true });
  await p.click('[aria-label="Documentation pages"] button:text-is("README")');
  await p.waitForFunction(
    () => /jeves ui/.test(document.querySelector('article.doc')?.textContent || ''),
    null,
    { timeout: 20000 },
  );
  const readmeHead = await p.textContent('article.doc');
  ok(
    'docs tab shows the README text, with the product name from the brand',
    /Jeves/.test(readmeHead) && /jeves ui/.test(readmeHead),
    readmeHead.slice(0, 80).replace(/\s+/g, ' '),
  );
  await p.click(
    '[aria-label="Documentation pages"] button:has-text("How Langfuse must be set up")',
  );
  await p.waitForFunction(
    () =>
      /must be set up/i.test(document.querySelector('article.doc')?.textContent || '') ||
      /chat-turn/.test(document.querySelector('article.doc')?.textContent || ''),
  );
  ok('picking a page shows that page', /chat-turn/.test(await p.textContent('article.doc')));
  await p.fill('input[aria-label="Search the documentation"]', 'how do I connect LiteLLM');
  await p.click('button:has-text("Search")');
  await p.waitForSelector('.hit', { timeout: 20000 });
  const hitText = (await p.$$eval('.hit', (e) => e.map((x) => x.textContent))).join(' ');
  ok(
    'search finds the LiteLLM section',
    /litellm/i.test(hitText),
    (await p.$$eval('.hit h4', (e) => e.map((x) => x.textContent.trim())))
      .join(' | ')
      .slice(0, 140),
  );
  await p.fill('input[aria-label="Search the documentation"]', 'when should I use eval-dashboards');
  await p.click('button:has-text("Search")');
  await p.waitForFunction(
    () =>
      /eval-dashboards/i.test(
        [...document.querySelectorAll('.hit')].map((x) => x.textContent).join(' '),
      ),
    null,
    { timeout: 20000 },
  );
  const edHits = (await p.$$eval('.hit', (e) => e.map((x) => x.textContent))).join(' ');
  ok(
    'search for eval-dashboards finds the page on using the two tools together',
    /eval-dashboards/i.test(edHits) &&
      /Use (Jeves|eval-dashboards|them together)|live-vs-offline/.test(edHits),
    (await p.$$eval('.hit h4', (e) => e.map((x) => x.textContent.trim())))
      .join(' | ')
      .slice(0, 140),
  );
  await p.fill('input[aria-label="Search the documentation"]', 'zzzqqq xqxqxq');
  await p.click('button:has-text("Search")');
  await p.waitForSelector('text=Nothing found');
  ok('a search with no match says so', true);
  // tables and the diagram on the README page
  await p.click('[aria-label="Documentation pages"] button:text-is("README")');
  await p.waitForSelector('article.doc table', { timeout: 20000 });
  const tableInfo = await p.$$eval('article.doc table', (tables) =>
    tables.map((t) => ({
      rows: t.querySelectorAll('tr').length,
      heads: [...t.querySelectorAll('th')].map((h) => h.textContent.trim()),
    })),
  );
  const commandTable = tableInfo.find((t) => t.heads.includes('Command'));
  ok(
    'docs README renders the command table as a real table',
    Boolean(commandTable) &&
      commandTable.heads.join('|') === 'Command|What it does' &&
      commandTable.rows >= 10,
    JSON.stringify(commandTable),
  );
  const rawPipes = await p.$$eval(
    'article.doc p',
    (ps) => ps.filter((x) => /\|\s*---\s*\|/.test(x.textContent)).length,
  );
  ok('docs README shows no raw table pipes as text', rawPipes === 0, String(rawPipes));
  await p.waitForSelector('article.doc img.diagram', { timeout: 30000 });
  const diagram = await p.$eval('article.doc img.diagram', (img) => ({
    ok: img.complete && img.naturalWidth > 100,
    w: img.naturalWidth,
    h: img.naturalHeight,
  }));
  ok('docs README draws the flow diagram as a picture', diagram.ok, JSON.stringify(diagram));
  ok(
    'docs README does not show the diagram source text',
    !/flowchart LR/.test(await p.textContent('article.doc')),
    '',
  );
  await p.screenshot({ path: T + '/d2-readme.png', fullPage: true });
  // every docs page: no raw markup left on screen, tables and code drawn, the diagram drawn
  const pageNames = await p.$$eval('[aria-label="Documentation pages"] button', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  for (const name of pageNames) {
    await p.click('[aria-label="Documentation pages"] button:text-is("' + name + '")');
    await p.waitForSelector('article.doc', { timeout: 20000 });
    await p.waitForTimeout(900);
    const raw = await p.evaluate(() => {
      const texts = [
        ...document.querySelectorAll(
          'article.doc p, article.doc li, article.doc td, article.doc th, article.doc h1, article.doc h2, article.doc h3, article.doc h4',
        ),
      ].map((x) => x.textContent || '');
      const bad = (re) => texts.filter((t) => re.test(t)).length;
      return {
        pipes: bad(/\|\s*---/),
        fences: bad(/```/),
        bold: bad(/\*\*[^*]+\*\*/),
        links: bad(/\]\([^)]+\)/),
        html: bad(/<\/?(br|img|picture|source|div|p|span|table|tr|td)\b[^>]*>/i),
        marks: [...document.querySelectorAll('article.doc p')].filter((x) =>
          /^#{1,4}\s/.test(x.textContent || ''),
        ).length,
      };
    });
    ok(
      'docs page "' + name + '" shows no raw markdown or HTML',
      Object.values(raw).every((n) => n === 0),
      JSON.stringify(raw),
    );
  }
  // every fenced block in the README must be a boxed block; none may be flattened into a paragraph
  const fenceCount =
    (await import('node:fs'))
      .readFileSync(path.join(ROOT, 'README.md'), 'utf8')
      .split('\n')
      .filter((l) => /^```/.test(l)).length / 2;
  await p.click('[aria-label="Documentation pages"] button:text-is("README")');
  await p.waitForSelector('article.doc img.diagram', { timeout: 30000 });
  await p.waitForTimeout(500);
  const blocks = await p.evaluate(() => ({
    pre: document.querySelectorAll('article.doc pre').length,
    mermaid: document.querySelectorAll('article.doc img.diagram').length,
    runOn: [...document.querySelectorAll('article.doc p')]
      .filter((x) => {
        const text = x.textContent || '';
        const codeChars = [...x.querySelectorAll('code')].reduce(
          (n, c) => n + (c.textContent || '').length,
          0,
        );
        return text.length > 220 && codeChars / text.length > 0.6 && /\s#\s/.test(text);
      })
      .map((x) => (x.textContent || '').slice(0, 60)),
  }));
  ok(
    'docs README draws every fenced block as a box',
    blocks.pre + blocks.mermaid === fenceCount,
    JSON.stringify({ fenceCount, ...blocks }),
  );
  ok(
    'docs README has no code flattened into a paragraph',
    blocks.runOn.length === 0,
    JSON.stringify(blocks.runOn),
  );
  // the settings reference is a plain-text file with // comments: it must show as a text block with its line breaks
  await p.click('[aria-label="Documentation pages"] button:text-is("Every setting")');
  await p.waitForSelector('article.doc .doc-source .doc-line', { timeout: 20000 });
  const settingsPage = await p.evaluate(() => {
    const block = document.querySelector('article.doc .doc-source');
    return {
      blocks: document.querySelectorAll('article.doc .doc-source').length,
      paragraphs: document.querySelectorAll('article.doc p').length,
      lines: document.querySelectorAll('article.doc .doc-source .doc-line').length,
      hasKey: /"activeProfile"/.test(block?.textContent || ''),
      wraps: document.querySelector('article.doc .doc-source .doc-line')
        ? getComputedStyle(document.querySelector('article.doc .doc-source .doc-line')).whiteSpace
        : '',
    };
  });
  ok(
    'docs "Every setting" shows as one text block with its line breaks',
    settingsPage.blocks === 1 &&
      settingsPage.paragraphs === 0 &&
      settingsPage.lines > 40 &&
      settingsPage.hasKey &&
      settingsPage.wraps === 'pre-wrap',
    JSON.stringify(settingsPage),
  );
  for (const name of pageNames) {
    await p.click('[aria-label="Documentation pages"] button:text-is("' + name + '")');
    await p.waitForSelector('article.doc', { timeout: 20000 });
    await p.waitForTimeout(700);
    const stray = await p.evaluate(
      () =>
        [...document.querySelectorAll('article.doc p, article.doc li, article.doc td')].filter(
          (x) => {
            const text = x.textContent || '';
            const startsWithComment = /^\s*\/\//.test(text);
            const manyComments = (text.match(/\/\//g) || []).length >= 4;
            return startsWithComment || manyComments;
          },
        ).length,
    );
    ok(
      'docs page "' + name + '" has no stray // comment text in a paragraph',
      stray === 0,
      String(stray),
    );
    const wide = await p.evaluate(
      () =>
        [...document.querySelectorAll('article.doc .table-scroll')].filter(
          (box) => box.scrollWidth > box.clientWidth + 2,
        ).length,
    );
    ok('docs page "' + name + '" has no table wider than the page', wide === 0, String(wide));
  }
  await p.click('[aria-label="Documentation pages"] button:text-is("README")');
  await p.waitForSelector('article.doc h1, article.doc h2');
  const imgs = await p.$$eval('article.doc img:not(.diagram)', (e) => e.length);
  const links = await p.$$eval('article.doc a', (e) =>
    e.map((x) => ({
      href: x.getAttribute('href'),
      rel: x.getAttribute('rel'),
      target: x.getAttribute('target'),
    })),
  );
  ok(
    'docs pages load no outside pictures (only the drawn diagram is a picture)',
    imgs === 0,
    String(imgs),
  );
  ok(
    'docs page has external links that open safely',
    links.length > 0 &&
      links.every(
        (l) => /^https?:/.test(l.href) && l.rel === 'noopener noreferrer' && l.target === '_blank',
      ),
    JSON.stringify(links.slice(0, 2)),
  );
  ok(
    'docs page has no relative or script links',
    !links.some((l) => /^(javascript:|\.|\/|#)/.test(l.href)),
    '',
  );
  ok(
    'docs README text kept the picture descriptions',
    /\[MIT licence\]|\[Jeves\]|\[Langfuse/.test(await p.textContent('article.doc')),
    '',
  );
  await p.screenshot({ path: T + '/d1-docs.png' });
  // The one deliberate backwards-window request is refused with a 400 and explained on the page;
  // the browser logs that refusal as two console lines. Anything else is a real error.
  const unexpected = errors.filter(
    (line) =>
      line !== 'HTTP 400 POST ' + url.split('?')[0] + 'api/rows' &&
      !/status of 400 \(Bad Request\)/.test(line),
  );
  ok(
    'no browser errors besides the one refused window',
    unexpected.length === 0,
    unexpected.join(' || ').slice(0, 200),
  );
  ok(
    'the refused window was the only 400',
    errors.filter((line) => /^HTTP 400/.test(line)).length === 1,
    errors.filter((line) => /^HTTP/.test(line)).join(' | '),
  );
  ok('no key value anywhere in the page', !(await p.content()).includes('SECRETMARKER'));
  console.log(log.join('\n'));
  await b.close();
  ui.kill('SIGINT');
  fake.kill();
  if (log.some((l) => l.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(log.join('\n'));
  console.log('SCRIPT STOPPED:', e.message.slice(0, 300));
  process.exit(1);
});
