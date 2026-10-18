import { describe, expect, it } from 'vitest';
import { renderBanner, type BannerInfo } from './banner.js';
import { stripAnsi } from './ansi.js';
import { createReporter } from './reporter.js';

function makeInfo(overrides: Partial<BannerInfo> = {}): BannerInfo {
  return {
    version: '0.1.0',
    configRows: [
      ['profile', 'dev'],
      ['langfuse', 'https://cloud.langfuse.com'],
    ],
    profiles: [
      { name: 'dev', baseUrl: 'https://cloud.langfuse.com', active: true },
      { name: 'prod', baseUrl: 'https://us.cloud.langfuse.com', active: false },
    ],
    commands: [['where', 'filter the loaded feedback']],
    showLogo: true,
    ...overrides,
  };
}

function makeStream(): { chunks: string[]; write: (text: string) => boolean } {
  const chunks: string[] = [];
  return {
    chunks,
    write: (text) => {
      chunks.push(text);
      return true;
    },
  };
}

describe('renderBanner', () => {
  it('should draw the JEVES logo and a titled panel when the logo is on', () => {
    const output = stripAnsi(renderBanner(makeInfo(), { columns: 120, color: false }));

    expect(output).toContain('     ██╗███████╗██╗   ██╗███████╗███████╗');
    expect(output).toContain('╭─ Jeves · Langfuse feedback CLI v0.1.0');
  });

  it('should list every profile and mark the active one when rendering', () => {
    const output = renderBanner(makeInfo(), { columns: 120, color: false });

    expect(output).toContain('* dev');
    expect(output).toContain('  prod');
  });

  it('should keep the config and profiles side by side when the terminal is wide', () => {
    const lines = renderBanner(makeInfo(), { columns: 140, color: false }).split('\n');

    expect(lines.some((line) => line.includes('profile') && line.includes('Profiles'))).toBe(true);
  });

  it('should stack the sections when the terminal is narrow', () => {
    const lines = renderBanner(makeInfo(), { columns: 70, color: false }).split('\n');

    expect(lines.some((line) => line.includes('profile') && line.includes('Profiles'))).toBe(false);
  });

  it('should explain what a profile is and name its env file when the banner is drawn', () => {
    const info = makeInfo({
      profiles: [
        {
          name: 'dev',
          baseUrl: 'https://cloud.langfuse.com',
          envFile: '/keys/dev.env',
          active: true,
        },
        {
          name: 'prod',
          baseUrl: 'https://cloud.langfuse.com',
          envFile: '/keys/prod.env',
          active: false,
        },
      ],
    });
    const output = stripAnsi(renderBanner(info, { columns: 200, color: false }));

    expect(output).toContain('A profile is a Langfuse address plus the');
    expect(output).toContain('choose the project you read.');
    expect(output).toMatch(/\* dev\s+dev\.env\s+https:\/\/cloud\.langfuse\.com/);
    expect(output).toMatch(/prod\s+prod\.env/);
  });

  it('should say a profile has no env file when none is saved', () => {
    const info = makeInfo({
      profiles: [{ name: 'dev', baseUrl: 'https://cloud.langfuse.com', active: true }],
    });

    expect(stripAnsi(renderBanner(info, { columns: 200, color: false }))).toContain(
      '(no env file)',
    );
  });

  it('should show a long config value in full when it needs more than one line', () => {
    const path = '/home/user/langfuse-reporter/prod.env';
    const info = makeInfo({ configRows: [['env file', path]] });
    const output = stripAnsi(renderBanner(info, { columns: 60, color: false }));
    const joined = output
      .split('\n')
      .filter((line) => line.startsWith('│'))
      .map((line) => line.slice(1, -1).trim())
      .join('')
      .replace(/\s+/g, '')
      .replace('envfile', '');

    expect(joined).toContain(path);
  });

  it('should never draw a line wider than the terminal when a config value is long', () => {
    const info = makeInfo({ configRows: [['env file', '/very/long/'.repeat(20)]] });
    const widest = Math.max(
      ...stripAnsi(renderBanner(info, { columns: 80, color: false }))
        .split('\n')
        .filter((line) => line.startsWith('│') || line.startsWith('╭') || line.startsWith('╰'))
        .map((line) => line.length),
    );

    expect(widest).toBeLessThanOrEqual(80);
  });

  it('should never draw a line wider than the terminal when a command hint is long', () => {
    const info = makeInfo({ commands: [['window', 'x'.repeat(120)]] });
    const widest = Math.max(
      ...stripAnsi(renderBanner(info, { columns: 80, color: false }))
        .split('\n')
        .filter((line) => line.startsWith('│') || line.startsWith('╭') || line.startsWith('╰'))
        .map((line) => line.length),
    );

    expect(widest).toBeLessThanOrEqual(80);
  });

  it('should emit no colour codes when colour is off', () => {
    const output = renderBanner(makeInfo(), { columns: 120, color: false });

    expect(output).toBe(stripAnsi(output));
  });

  it('should emit the banner gold when colour is on', () => {
    const output = renderBanner(makeInfo(), { columns: 120, color: true });

    expect(output).toContain('\u001b[38;2;255;215;0m');
  });
});

describe('createReporter in plain mode', () => {
  it('should print a start line and a tick when a task succeeds', () => {
    const stream = makeStream();
    const task = createReporter({ stream, interactive: false }).task('Fetching');

    task.succeed('Fetched 3');

    expect(stream.chunks).toEqual(['… Fetching\n', '✓ Fetched 3\n']);
  });

  it('should print a cross when a task fails', () => {
    const stream = makeStream();
    const task = createReporter({ stream, interactive: false }).task('Fetching');

    task.fail('Could not fetch');

    expect(stream.chunks).toEqual(['… Fetching\n', '✗ Could not fetch\n']);
  });

  it('should reuse the start label when a task succeeds without a message', () => {
    const stream = makeStream();
    const task = createReporter({ stream, interactive: false }).task('Writing files');

    task.succeed();

    expect(stream.chunks.at(-1)).toBe('✓ Writing files\n');
  });

  it('should print warnings and notes on their own lines when reporting', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });

    reporter.warn('Langfuse answered 429; retry 1 in 4s');
    reporter.info('No export folder configured');

    expect(stream.chunks).toEqual([
      '! Langfuse answered 429; retry 1 in 4s\n',
      '· No export folder configured\n',
    ]);
  });
});

describe('createReporter on a terminal', () => {
  const colourful = (): {
    stream: ReturnType<typeof makeStream>;
    reporter: ReturnType<typeof createReporter>;
  } => {
    const stream = makeStream();
    return { stream, reporter: createReporter({ stream, interactive: true }) };
  };

  it.each([
    ['connect', '🔑'],
    ['fetch', '📥'],
    ['conversations', '💬'],
    ['match', '🔗'],
    ['filter', '🔎'],
    ['write', '📊'],
  ] as const)('should finish a %s step with its own emoji when it succeeds', (kind, emoji) => {
    const { stream, reporter } = colourful();

    reporter.task('Working', kind).succeed('Done');

    expect(stripAnsi(stream.chunks.at(-1) ?? '')).toBe(`✓ ${emoji} Done\n`);
  });

  it('should colour the tick green when a step succeeds', () => {
    const { stream, reporter } = colourful();

    reporter.task('Working', 'fetch').succeed('Done');

    expect(stream.chunks.at(-1)).toContain('\u001b[38;2;127;209;139m');
  });

  it('should colour the cross red when a step fails', () => {
    const { stream, reporter } = colourful();

    reporter.task('Working', 'fetch').fail('Broke');

    expect(stream.chunks.at(-1)).toContain('\u001b[38;2;255;107;107m');
  });

  it('should add a warning emoji when warning on a terminal', () => {
    const { stream, reporter } = colourful();

    reporter.warn('Careful');

    expect(stripAnsi(stream.chunks.join(''))).toContain('! ⚠️  Careful');
  });

  it('should draw a block with a heading emoji and aligned labels when the output is a terminal', () => {
    const { stream, reporter } = colourful();

    reporter.block({
      title: 'Search criteria',
      rows: [
        ['filter', 'none'],
        ['date window', 'last month'],
      ],
    });

    expect(stripAnsi(stream.chunks.join(''))).toContain('🔎 Search criteria');
  });

  it('should keep emoji out of plain output when not on a terminal', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });

    reporter.task('Working', 'fetch').succeed('Done');
    reporter.warn('Careful');
    reporter.block({ title: 'Search criteria', rows: [['filter', 'none']] });

    expect(stream.chunks.join('')).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('should print a block as aligned plain text when not on a terminal', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });

    reporter.block({
      title: 'Search criteria',
      rows: [
        ['filter', 'none'],
        ['date window', 'last month'],
      ],
    });

    expect(stream.chunks).toEqual([
      'Search criteria\n',
      '  filter       none\n',
      '  date window  last month\n',
    ]);
  });
});

describe('Reporter.block with line breaks', () => {
  it('should keep a value on one row when it contains a line break', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });

    reporter.block({ title: 'Project', rows: [['name', 'Acme\nforged row']] });

    expect(stream.chunks).toEqual(['Project\n', '  name  Acme forged row\n']);
  });
});

describe('Reporter colour', () => {
  it('should print no colour on a terminal when colour is turned off', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: true, color: false });

    reporter.done('Loaded');

    expect(stream.chunks.join('')).not.toContain(`${String.fromCharCode(27)}[3`);
  });
});

describe('Reporter.cancel', () => {
  it('should stop redrawing the spinner when a step was left running by an error', async () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: true });
    reporter.task('Saving', 'save');

    reporter.cancel();
    const written = stream.chunks.length;
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(stream.chunks.length).toBe(written);
  });

  it('should do nothing when no step is running', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: true });

    reporter.cancel();

    expect(stream.chunks).toEqual([]);
  });

  it('should keep a finished step finished when cancel is called afterwards', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });
    reporter.task('Saving').succeed('Saved');

    reporter.cancel();

    expect(stream.chunks).toEqual(['… Saving\n', '✓ Saved\n']);
  });
});

describe('Reporter output safety', () => {
  const ESC = String.fromCharCode(27);

  it.each(['done', 'info', 'warn', 'note'] as const)(
    'should strip escape sequences when %s text contains them',
    (method) => {
      const stream = makeStream();
      const reporter = createReporter({ stream, interactive: false });

      reporter[method](`before${ESC}[2Jafter`);

      expect(stream.chunks.join('')).toBe(
        method === 'done'
          ? '✓ beforeafter\n'
          : `${{ info: '· ', warn: '! ', note: '' }[method]}beforeafter\n`,
      );
    },
  );

  it('should strip escape sequences when a block title, label or value contains them', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });

    reporter.block({
      title: `T${ESC}[2J`,
      rows: [[`l${ESC}]0;x${String.fromCharCode(7)}`, `v${ESC}[H`]],
    });

    expect(stream.chunks.join('')).not.toContain(ESC);
  });

  it('should strip escape sequences when a step message contains them', () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, interactive: false });

    reporter.task('Working').succeed(`done${ESC}[2J`);

    expect(stream.chunks.at(-1)).toBe('✓ done\n');
  });
});

describe('renderBanner with hostile config values', () => {
  const ESC = String.fromCharCode(27);

  it('should strip terminal control sequences when a config value contains them', () => {
    const info = makeInfo({
      configRows: [
        ['output dir', `/tmp/x${ESC}[2J${ESC}]0;pwned${String.fromCharCode(7)}`],
        [`la${ESC}[H`, 'v'],
      ],
      profiles: [{ name: `p${ESC}[2J`, baseUrl: `https://a.test${ESC}]0;t`, active: true }],
      commands: [[`c${ESC}[H`, `h${ESC}[2J`]],
    });

    const output = stripAnsi(renderBanner(info, { columns: 120, color: false }));

    expect(output).not.toContain(ESC);
    expect(output).not.toContain('pwned');
  });
});

describe('createReporter document', () => {
  const evil = 'hello \x1b]0;pwned\x07 \x1b[2J\x1b[31mred\x1b[0m world';

  it.each([
    ['in a pipe', { interactive: false, color: false }],
    ['on a terminal with NO_COLOR', { interactive: true, color: false }],
    ['on a terminal with colour', { interactive: true, color: true }],
  ])('should drop the escape sequences of the text when the output is %s', (_label, mode) => {
    const stream = makeStream();

    createReporter({ stream, columns: 80, ...mode }).document(evil);

    expect(stripAnsi(stream.chunks.join('')).replace(/\s+/g, ' ')).toContain('hello red world');
  });

  it('should print nothing of the title or clear sequences when the text carries them', () => {
    const stream = makeStream();

    createReporter({ stream, columns: 80, interactive: false, color: false }).document(evil);

    expect(stream.chunks.join('')).toBe('hello  red world\n');
  });
});

describe('createReporter document with a title', () => {
  it('should frame the reply when a title is given on a terminal', () => {
    const stream = makeStream();

    createReporter({ stream, columns: 60, interactive: true, color: false }).document(
      'hello',
      'Jeves',
    );

    expect(
      stripAnsi(stream.chunks.join(''))
        .split('\n')
        .filter((line) => line.includes('Jeves') || line.includes('╰')),
    ).toHaveLength(2);
  });

  it('should print only the text when a title is given in a pipe', () => {
    const stream = makeStream();

    createReporter({ stream, columns: 60, interactive: false, color: false }).document(
      'hello',
      'Jeves',
    );

    expect(stream.chunks.join('')).toBe('hello\n');
  });

  it('should drop escape sequences from the title when a title is given', () => {
    const stream = makeStream();

    createReporter({ stream, columns: 60, interactive: true, color: false }).document(
      'x',
      'A\x1b[2JB',
    );

    expect(stream.chunks.join('')).not.toContain('[2J');
  });
});

describe('Reporter.section', () => {
  const lines = (stream: { chunks: string[] }): string[] =>
    stripAnsi(stream.chunks.join(''))
      .replaceAll('\r', '')
      .split('\n')
      .filter((line) => line !== '');

  it('should print a titled top line, the body, then a closing line when on a terminal', async () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, columns: 40, interactive: true, color: false });

    await reporter.section('Jeves · doctor', () => reporter.note('inside'));

    expect(lines(stream)).toEqual([
      '╭─ Jeves · doctor ────────────────────╮',
      'inside',
      '╰─────────────────────────────────────╯',
    ]);
  });

  it('should print only the body when the output is a pipe', async () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, columns: 40, interactive: false, color: false });

    await reporter.section('Jeves · doctor', () => reporter.note('inside'));

    expect(lines(stream)).toEqual(['inside']);
  });

  it('should still print the closing line when the body throws', async () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, columns: 40, interactive: true, color: false });

    await reporter
      .section('Jeves · doctor', () => Promise.reject(new Error('boom')))
      .catch(() => undefined);

    expect(lines(stream).at(-1)).toBe('╰─────────────────────────────────────╯');
  });

  it('should give back what the body returns when it succeeds', async () => {
    const reporter = createReporter({
      stream: makeStream(),
      columns: 40,
      interactive: true,
      color: false,
    });

    expect(await reporter.section('T', () => 7)).toBe(7);
  });

  it('should drop escape sequences from the title when it contains them', async () => {
    const stream = makeStream();
    const reporter = createReporter({ stream, columns: 40, interactive: true, color: false });

    await reporter.section('A\x1b[2JB', () => undefined);

    expect(stream.chunks.join('')).not.toContain('[2J');
  });
});
