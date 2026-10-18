import { brand, promptWord, type Brand } from '../brand/brand.js';
import { fileURLToPath } from 'node:url';
import { readSmallTextFile } from '../config/safe-read.js';

export interface DocPage {
  /** Short name shown to the user. */
  name: string;
  text: string;
}

/** A heading and the text under it: the unit the offline search ranks. */
export interface DocSection {
  page: string;
  heading: string;
  text: string;
}

/** The pages bundled with the package, anchored to it so the command works from any folder. */
const PAGES: ReadonlyArray<readonly [name: string, path: string]> = [
  ['langfuse-setup', '../../docs/langfuse-setup.md'],
  ['readme', '../../README.md'],
  ['config-reference', '../../docs/config.json.local'],
];

/** The names the shipped pages are written with; they are swapped for the configured ones when read. */
const WRITTEN_COMMAND = 'jeves';
const WRITTEN_NAME = 'Jeves';
const WRITTEN_PROMPT = 'jeves[';

/** Rewrites the names a page was written with into the configured product names. */
export function withBrandNames(text: string, names: Brand = brand): string {
  return text
    .replaceAll(WRITTEN_PROMPT, `${promptWord(names)}[`)
    .replaceAll(WRITTEN_COMMAND, names.command)
    .replaceAll(WRITTEN_NAME, names.name);
}

export async function loadDocPages(): Promise<DocPage[]> {
  return Promise.all(
    PAGES.map(async ([name, path]) => ({
      name,
      text: withBrandNames(await readSmallTextFile(fileURLToPath(new URL(path, import.meta.url)))),
    })),
  );
}

const HEADING = /^#{1,3}\s+(.*)$/;

export function splitSections(page: DocPage): DocSection[] {
  const sections: DocSection[] = [];
  let heading = page.name;
  let lines: string[] = [];
  const flush = (): void => {
    const text = lines.join('\n').trim();
    if (text) sections.push({ page: page.name, heading, text });
    lines = [];
  };
  for (const line of page.text.split('\n')) {
    const found = HEADING.exec(line);
    if (found) {
      flush();
      heading = found[1] ?? heading;
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'of',
  'and',
  'or',
  'in',
  'on',
  'for',
  'it',
  'do',
  'does',
  'how',
  'what',
  'why',
  'can',
  'i',
  'my',
  'me',
  'this',
  'that',
  'with',
  'be',
  'cli',
  ...brand.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean),
]);

function words(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9_.-]+/g) ?? [];
  return tokens
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/** Ranks sections by how many of the question's words they contain, headings counting double. */
export function searchSections(
  sections: readonly DocSection[],
  question: string,
  limit = 3,
): DocSection[] {
  const wanted = new Set(words(question));
  const scored = sections.map((section) => {
    const body = new Set(words(section.text));
    const head = new Set(words(section.heading));
    let score = 0;
    for (const word of wanted) score += (body.has(word) ? 1 : 0) + (head.has(word) ? 2 : 0);
    return { section, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.section);
}

/** The system prompt: answer only from the bundled pages, and say so when they do not cover it. */
export function buildDocsPrompt(pages: readonly DocPage[]): string {
  const material = pages.map((page) => `=== ${page.name} ===\n${page.text}`).join('\n\n');
  return [
    `You answer questions about ${brand.command}, a command-line tool that reads user feedback from Langfuse.`,
    'Answer only from the documentation below. If it does not cover the question, say so plainly and do not guess.',
    'Write in short, plain sentences. Give exact commands in code. When the question is about setup, say why the setup is needed.',
    '',
    material,
  ].join('\n');
}
