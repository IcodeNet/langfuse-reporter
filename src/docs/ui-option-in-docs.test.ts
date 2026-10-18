import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

/** The sections of the README that explain how to set something up by typing `config set` or editing the file. */
function sectionsThatConfigure(markdown: string): Array<{ title: string; body: string }> {
  const parts = markdown.split(/^(#{2,3} .+)$/m);
  const sections: Array<{ title: string; body: string }> = [];
  for (let index = 1; index < parts.length; index += 2) {
    sections.push({ title: (parts[index] ?? '').trim(), body: parts[index + 1] ?? '' });
  }
  return sections.filter(({ body }) => /^jeves config (set|use) /m.test(body));
}

/** Sections that print the full list of settings or the page itself, where a pointer to the page would only repeat the section. */
const EXEMPT = new Set([
  '## Questions people ask',
  '## What this tool does not do',
  '## If something goes wrong',
  '### What each setting means',
  '## The browser page',
  '## Use it in a pipeline',
  '## For scripts and editors',
]);

describe('README sections that explain configuring', () => {
  const sections = sectionsThatConfigure(readme).filter(({ title }) => !EXEMPT.has(title));

  it('should find the configuring sections when the README is read', () => {
    expect(sections.length).toBeGreaterThanOrEqual(6);
  });

  it('should mention the browser page in every section that explains configuring by typing', () => {
    const without = sections
      .filter(({ body }) => !/jeves (--profile \w+ )?ui\b/.test(body))
      .map(({ title }) => title);

    expect(without).toEqual([]);
  });
});

describe('the other setup docs', () => {
  it.each(['docs/langfuse-setup.md', 'docs/bring-your-own-schema.md'])(
    'should mention the browser page when %s explains configuring',
    (file) => {
      expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/jeves ui/);
    },
  );
});
