/**
 * Opens every page of the Docs tab in a real browser and reports what is left on screen that should
 * have been turned into formatting: table pipes, code fences, bold markers, link syntax, HTML tags,
 * and a diagram that did not draw. Run: node ui/e2e/docs-audit.cjs
 */
const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jeves-docs-'));
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
fs.writeFileSync(
  path.join(T, 'c.json'),
  JSON.stringify({
    activeProfile: 'dev',
    profiles: { dev: { baseUrl: 'https://cloud.langfuse.com' } },
  }),
);
const running = [];
process.on('exit', () =>
  running.forEach((c) => {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }),
);
setTimeout(() => {
  console.log('docs audit took longer than 3 minutes');
  process.exit(1);
}, 180000).unref();

(async () => {
  const ui = spawn(
    path.join(ROOT, 'node_modules/.bin/tsx'),
    ['src/index.ts', '--config', path.join(T, 'c.json'), 'ui', '--no-open'],
    { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  running.push(ui);
  const url = await new Promise((resolve) => {
    let out = '';
    ui.stdout.on('data', (d) => {
      out += d;
      const l = out.split('\n').find((x) => x.startsWith('http://'));
      if (l) resolve(l.trim());
    });
  });
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 1200 } });
  const errors = [];
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await p.goto(url);
  await p.click('button.tab:has-text("Docs")');
  await p.waitForSelector('[aria-label="Documentation pages"] button');
  const names = await p.$$eval('[aria-label="Documentation pages"] button', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  const report = [];
  for (const name of names) {
    await p.click(`[aria-label="Documentation pages"] button:text-is("${name}")`);
    await p.waitForSelector('article.doc', { timeout: 20000 });
    await p.waitForTimeout(1200);
    const facts = await p.evaluate(() => {
      const doc = document.querySelector('article.doc');
      const own = (el) => el.textContent || '';
      const paragraphs = [...doc.querySelectorAll('p, li, td, th, h1, h2, h3, h4')].map(own);
      const hits = (re) =>
        paragraphs.filter((t) => re.test(t)).map((t) => t.replace(/\s+/g, ' ').slice(0, 90));
      return {
        rawTablePipes: hits(/\|\s*---/),
        rawComments: paragraphs
          .filter((t) => /^\s*\/\//.test(t) || (t.match(/\/\//g) || []).length >= 4)
          .map((t) => t.replace(/\s+/g, ' ').slice(0, 90)),
        rawFences: hits(/```/),
        rawBold: hits(/\*\*[^*]+\*\*/),
        rawLinks: hits(/\]\([^)]+\)/),
        rawHtml: hits(/<\/?(br|img|picture|source|div|p|span|table|tr|td)\b[^>]*>/i),
        rawEntities: hits(/&(amp|lt|gt|quot|nbsp);/),
        rawHeadingMarks: [...doc.querySelectorAll('p')]
          .map(own)
          .filter((t) => /^#{1,4}\s/.test(t))
          .map((t) => t.slice(0, 60)),
        tables: doc.querySelectorAll('table').length,
        overflowing: [...doc.querySelectorAll('.table-scroll')]
          .map((box) => ({
            heads: [...box.querySelectorAll('th')]
              .map((h) => h.textContent.trim())
              .join('|')
              .slice(0, 60),
            scroll: box.scrollWidth,
            client: box.clientWidth,
          }))
          .filter((x) => x.scroll > x.client + 2),
        clippedCode: [...doc.querySelectorAll('pre')].filter(
          (p) => p.scrollWidth > p.clientWidth + 2,
        ).length,
        textBlocks: doc.querySelectorAll('pre.doc-source').length,
        codeBlocks: doc.querySelectorAll('pre').length,
        diagrams: [...doc.querySelectorAll('img.diagram')].map((i) => ({
          ok: i.complete && i.naturalWidth > 0,
          w: i.naturalWidth,
          h: i.naturalHeight,
          src: i.src.slice(0, 40),
        })),
        diagramFailedText: /flowchart|sequenceDiagram|graph (TD|LR)/.test(own(doc)),
        headings: doc.querySelectorAll('h1,h2,h3').length,
        textLength: own(doc).length,
      };
    });
    await p.screenshot({
      path: path.join(T, `docs-${name.replace(/\W+/g, '-')}.png`),
      fullPage: true,
    });
    report.push({ page: name, ...facts });
  }
  fs.writeFileSync(path.join(T, 'report.json'), JSON.stringify({ report, errors }, null, 1));
  console.log(
    JSON.stringify(
      {
        folder: T,
        pages: report.map((r) => ({
          page: r.page,
          tables: r.tables,
          code: r.codeBlocks,
          headings: r.headings,
          diagrams: r.diagrams,
          diagramFailedText: r.diagramFailedText,
          overflowing: r.overflowing,
          clippedCode: r.clippedCode,
          raw: {
            pipes: r.rawTablePipes.length,
            fences: r.rawFences.length,
            bold: r.rawBold.length,
            links: r.rawLinks.length,
            html: r.rawHtml.length,
            entities: r.rawEntities.length,
            headings: r.rawHeadingMarks.length,
          },
        })),
        errors,
      },
      null,
      1,
    ),
  );
  await b.close();
  process.exit(0);
})();
