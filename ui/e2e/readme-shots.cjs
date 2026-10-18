/**
 * Takes the README pictures of the browser page: a real `jeves ui` against a fake Langfuse that holds
 * invented sample data, in a throwaway folder with a neutral path. Run: pnpm shots:ui [folder]
 * Needs the page built (pnpm build:ui) and CHROME_PATH or a Playwright Chromium.
 */
const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/images'));
const BASE = '/tmp/jeves-demo';
const PORT = '8841';
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const running = [];

process.on('exit', () => {
  for (const child of running) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
});
setTimeout(() => {
  console.log('The picture run took longer than 3 minutes and was stopped.');
  process.exit(1);
}, 180_000).unref();

fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(BASE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(BASE, 'keys.env'),
  'LANGFUSE_PUBLIC_KEY=pk-lf-demo\nLANGFUSE_SECRET_KEY=sk-lf-demo\n',
);
const CONFIG = path.join(BASE, 'config.json');
fs.writeFileSync(
  CONFIG,
  JSON.stringify({
    activeProfile: 'dev',
    outDir: path.join(BASE, 'reports'),
    profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
  }),
);

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  running.push(child);
  return child;
}

(async () => {
  start(
    process.execPath,
    [path.join(__dirname, 'fake-langfuse.mjs'), PORT, 'chat-turn', 'feedback_helpful', 'feedback_'],
    { FAKE_NICE: '1' },
  );
  await sleep(700);
  const ui = start(path.join(ROOT, 'node_modules/.bin/tsx'), [
    'src/index.ts',
    '--config',
    CONFIG,
    'ui',
    '--no-open',
  ]);
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('jeves ui printed no link in 20s')), 20_000);
    ui.stdout.on('data', (chunk) => {
      out += chunk;
      const link = out.split('\n').find((line) => line.startsWith('http://'));
      if (link) {
        clearTimeout(timer);
        resolve(link.trim());
      }
    });
  });
  const token = new URL(url).searchParams.get('token');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({
    viewport: { width: 900, height: 1000 },
    deviceScaleFactor: 2,
  });
  const shot = (name) => page.locator('main').screenshot({ path: path.join(OUT, name) });

  await page.goto(url);
  await page.waitForSelector('text=Which Langfuse do you use?');
  await shot('ui-setup-address.png');

  for (const [key, value] of [
    ['profile.baseUrl', `http://127.0.0.1:${PORT}`],
    ['profile.envFile', path.join(BASE, 'keys.env')],
  ]) {
    const result = await page.evaluate(
      async ([k, v, t]) => {
        const response = await fetch('api/config-set', {
          method: 'POST',
          headers: { 'x-setup-token': t, 'content-type': 'application/json' },
          body: JSON.stringify({ key: k, value: v }),
        });
        return response.json();
      },
      [key, value, token],
    );
    if (!result.ok) throw new Error(`could not set ${key}: ${result.message}`);
  }
  await page.reload();
  for (let i = 0; i < 3; i += 1) {
    await page.click('button:text-is("Next")');
    await sleep(300);
  }
  await page.waitForSelector('text=What do you call your turns');
  await page.click('button:has-text("Look at my project")');
  await page.waitForSelector('.chips .chip');
  await page.waitForFunction(() => !/Checking your project/.test(document.body.textContent || ''));
  await shot('ui-setup-names.png');

  await page.click('button.tab:has-text("Reports")');
  await page.waitForSelector('h2:text-is("Reports")');
  await page.fill('input[aria-label="From date"]', '2026-09-01');
  await page.fill('input[aria-label="To date"]', '2026-10-01');
  await page.click('button:has-text("Show the ratings")');
  await page.waitForSelector('table.grid');
  await page.click('button:has-text("Write the files")');
  await page.waitForFunction(() =>
    /Wrote \d+ of \d+/.test(document.querySelector('.result')?.textContent || ''),
  );
  await shot('ui-reports.png');

  await page.click('button.tab:has-text("Docs")');
  await page.waitForSelector('article.doc');
  await page.fill('input[aria-label="Search the documentation"]', 'how do I connect LiteLLM');
  await page.click('button:has-text("Search")');
  await page.waitForSelector('.hit');
  await shot('ui-docs.png');

  await page.click('button.tab:has-text("Check everything")');
  await page.waitForSelector('.check');
  await page.waitForFunction(() => !/Checking…/.test(document.body.textContent || ''));
  await shot('ui-check.png');
  await browser.close();
  console.log(`Wrote 5 pictures to ${OUT}`);
  process.exit(0);
})().catch((error) => {
  console.log(`The picture run failed: ${error.message}`);
  process.exit(1);
});
