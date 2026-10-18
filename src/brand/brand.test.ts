import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withBrandNames } from '../docs/docs-library.js';
import { brand, promptWord, type Brand } from './brand.js';
import { binFor, packageWithBrand } from './sync-package.js';

const PULSE: Brand = {
  name: 'Pulse',
  command: 'pulse-cli',
  aliases: ['pulse'],
  launcher: './dist/index.js',
  configDir: 'pulse-reporter',
};

describe('brand', () => {
  it('should write the prompt word in lower case when the name has capitals', () => {
    expect(promptWord(PULSE)).toBe('pulse');
  });

  it('should keep the names of the shipped product when brand.json is untouched', () => {
    expect([brand.name, brand.command]).toEqual(['Jeves', 'jeves']);
  });
});

describe('the product name in the source', () => {
  it('should appear in no code line when the source is scanned outside the font, the docs reader and the brand file', () => {
    const root = join(import.meta.dirname, '..');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (path) => path.endsWith('.ts') && !path.endsWith('.test.ts'),
    );
    const codeLines = files
      .filter(
        (path) => path !== join('docs', 'docs-library.ts') && path !== join('brand', 'logo.ts'),
      )
      .flatMap((path) =>
        readFileSync(join(root, path), 'utf8')
          .split('\n')
          .map((text, index) => `${path}:${index + 1}: ${text.trim()}`),
      );

    expect(
      codeLines.filter((line) => /jeves/i.test(line) && !/: (\/\/|\/\*|\*)/.test(line)),
    ).toEqual([]);
  });
});

describe('withBrandNames', () => {
  it('should swap the command, the name and the prompt when the brand changes', () => {
    expect(
      withBrandNames('Run jeves doctor. Jeves reads ratings. Prompt jeves[dev]>.', PULSE),
    ).toBe('Run pulse-cli doctor. Pulse reads ratings. Prompt pulse[dev]>.');
  });

  it('should leave the text as it is when the brand is the shipped one', () => {
    const text = 'Run jeves doctor. Jeves reads ratings. Prompt jeves[dev]>.';

    expect(withBrandNames(text, { ...brand, aliases: [] })).toBe(text);
  });
});

describe('package.json bin', () => {
  it('should list the command and each alias against the launcher when the brand is read', () => {
    expect(binFor(PULSE)).toEqual({ 'pulse-cli': './dist/index.js', pulse: './dist/index.js' });
  });

  it('should match the configured brand when the committed package.json is read', () => {
    const file = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as {
      bin: Record<string, string>;
    };

    expect(file.bin).toEqual(binFor(brand));
  });

  it('should change only bin when package.json is synced', () => {
    const before = readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8');
    const original = JSON.parse(before) as Record<string, unknown>;
    const after = JSON.parse(packageWithBrand(before, PULSE)) as Record<string, unknown>;

    expect({ ...after, bin: undefined }).toEqual({ ...original, bin: undefined });
  });
});
