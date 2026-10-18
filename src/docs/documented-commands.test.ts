import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const DOC_FILES = [
  'README.md',
  ...readdirSync(join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join('docs', name)),
  ...readdirSync(join(ROOT, 'skills'))
    .map((name) => join('skills', name, 'SKILL.md'))
    .filter((path) => statSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile()),
];

/** The shell words of a command line, honouring single and double quotes. Undefined when a quote is left open. */
export function splitWords(line: string): string[] | undefined {
  const words: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
    }
  }
  if (quote) return undefined;
  if (started || current) words.push(current);
  return words;
}

/** Every `jeves ...` command shown in a doc: whole lines of sh blocks, and inline code spans. */
export function commandsIn(markdown: string): string[] {
  const found: string[] = [];
  let inShell = false;
  for (const line of markdown.split('\n')) {
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      inShell = !inShell && ['sh', 'bash', 'shell', 'console'].includes(fence[1] ?? '');
      continue;
    }
    if (inShell) {
      const text = line.replace(/^\s*\$\s*/, '').replace(/\s+#.*$/, '');
      if (text.startsWith('jeves ')) found.push(text.trim());
      continue;
    }
    for (const span of line.matchAll(/`(jeves [^`]+)`/g)) found.push((span[1] ?? '').trim());
  }
  return found;
}

/** A command that cannot be checked as written: a placeholder, a pipe, a redirect, an ellipsis, a list of names or a bare prompt. */
function isTemplate(command: string): boolean {
  return /[<>|,]|\.\.\.|\[|\bjeves\s*$|\$\(|&&|;/.test(command);
}

/**
 * The parser stops early, without a fault, for these: help and version are asked for, or the
 * command is named in prose with its required words left out.
 */
const ACCEPTED_CODES = new Set([
  'commander.version',
  'commander.helpDisplayed',
  'commander.help',
  'commander.missingArgument',
]);

/** Runs commander's parser on the command with every action removed, so nothing executes. Returns the error text, or undefined. */
function parseProblem(words: string[]): string | undefined {
  const program = buildProgram(['node', 'jeves']);
  const visit = (command: typeof program): void => {
    command.exitOverride();
    command.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    command.action(() => undefined);
    command.commands.forEach(visit);
  };
  visit(program);
  try {
    program.parse(['node', 'jeves', ...words.slice(1)]);
    return undefined;
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
    if (ACCEPTED_CODES.has(code)) return undefined;
    return err instanceof Error ? err.message : String(err);
  }
}

describe('documented commands', () => {
  const documented = DOC_FILES.flatMap((file) =>
    commandsIn(readFileSync(join(ROOT, file), 'utf8')).map((command) => ({ file, command })),
  ).filter(({ command }) => !isTemplate(command));

  it('should find a useful number of commands when the docs are read', () => {
    expect(documented.length).toBeGreaterThan(60);
  });

  it('should parse every command the docs show when it is checked against the real program', () => {
    const problems = documented.flatMap(({ file, command }) => {
      const words = splitWords(command);
      if (words === undefined) return [`${file}: open quote in: ${command}`];
      const problem = parseProblem(words);
      return problem === undefined ? [] : [`${file}: ${command}  ->  ${problem}`];
    });

    expect(problems).toEqual([]);
  });
});

describe('commandsIn', () => {
  it('should read a command from an sh block and from an inline span when both are present', () => {
    const text = 'Run `jeves doctor` now.\n```sh\njeves --demo   # sample\n```\n';

    expect(commandsIn(text)).toEqual(['jeves doctor', 'jeves --demo']);
  });

  it('should ignore a jeves line in a block that is not a shell block', () => {
    expect(commandsIn('```text\njeves doctor\n```\n')).toEqual([]);
  });
});

describe('splitWords', () => {
  it('should keep a quoted filter as one word when the command has quotes', () => {
    expect(splitWords('jeves feedback export --where "rating = negative"')).toEqual([
      'jeves',
      'feedback',
      'export',
      '--where',
      'rating = negative',
    ]);
  });

  it('should return nothing when a quote is left open', () => {
    expect(splitWords('jeves docs "how')).toBeUndefined();
  });
});
