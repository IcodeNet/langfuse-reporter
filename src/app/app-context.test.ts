import { afterEach, describe, expect, it } from 'vitest';
import { createAppContext, printBanner } from './app-context.js';
import { makeMockResolvedConfig } from '../config/__mocks__/makeMockResolvedConfig.mock.js';

const original = process.stderr.columns;
const originalIsTTY = process.stderr.isTTY;
const originalNoColor = process.env.NO_COLOR;

afterEach(() => {
  process.stderr.columns = original;
  process.stderr.isTTY = originalIsTTY;
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

describe('createAppContext', () => {
  it('should use 80 columns when the terminal reports zero width', () => {
    process.stderr.columns = 0;

    expect(createAppContext('/tmp/c.json', undefined).columns).toBe(80);
  });

  it('should use the real width when the terminal reports one', () => {
    process.stderr.columns = 132;

    expect(createAppContext('/tmp/c.json', undefined).columns).toBe(132);
  });

  it('should stay interactive but drop colour when NO_COLOR is set on a terminal', () => {
    process.stderr.isTTY = true;
    process.env.NO_COLOR = '1';

    const app = createAppContext('/tmp/c.json', undefined);

    expect({ interactive: app.interactive, color: app.color }).toEqual({
      interactive: true,
      color: false,
    });
  });

  it('should carry the dates into the context when they are given on the command line', () => {
    const app = createAppContext('/tmp/c.json', undefined, {
      from: '2026-10-01',
      to: '2026-10-13',
    });

    expect(app.window).toEqual({ from: '2026-10-01', to: '2026-10-13' });
  });
});

describe('printBanner colour', () => {
  const writes: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);

  afterEach(() => {
    process.stderr.write = realWrite;
    writes.length = 0;
  });

  function bannerText(): string {
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(String(chunk));
      return true;
    };
    printBanner(createAppContext('/tmp/none-config.json', undefined), makeMockResolvedConfig());
    return writes.join('');
  }

  it('should print no colour codes when NO_COLOR is set on a terminal', () => {
    process.stderr.isTTY = true;
    process.env.NO_COLOR = '1';

    expect(bannerText().includes('\u001b[')).toBe(false);
  });

  it('should print colour codes when the terminal has colour', () => {
    process.stderr.isTTY = true;
    delete process.env.NO_COLOR;

    expect(bannerText().includes('\u001b[')).toBe(true);
  });
});
