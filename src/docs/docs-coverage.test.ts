import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '../cli.js';
import { SESSION_COMMANDS } from '../session/session-commands.js';
import { loadDocPages } from './docs-library.js';

function commandPaths(command: Command, prefix: string[] = []): string[] {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    return [path.join(' '), ...commandPaths(child, path)];
  });
}

function optionNames(command: Command): string[] {
  const own = command.options.flatMap((option) => (option.long ? [option.long] : []));
  return [...own, ...command.commands.flatMap(optionNames)];
}

async function docsText(): Promise<string> {
  const pages = await loadDocPages();
  return pages.map((page) => page.text).join('\n');
}

describe('docs coverage', () => {
  it('should name every command in the pages the docs command reads when the program is built', async () => {
    const text = await docsText();
    const program = buildProgram(['node', 'jeves']);

    const undocumented = commandPaths(program).filter((path) => !text.includes(path));

    expect(undocumented).toEqual([]);
  });

  it('should name every option in the pages the docs command reads when the program is built', async () => {
    const text = await docsText();
    const program = buildProgram(['node', 'jeves']);

    const undocumented = [...new Set(optionNames(program))].filter((name) => !text.includes(name));

    expect(undocumented).toEqual([]);
  });

  it('should list every session command in the README sentence that names them when the session knows them', async () => {
    const text = await docsText();
    const sentence = text.match(/The session commands are:[^\n]*/)?.[0] ?? '';

    const missing = SESSION_COMMANDS.map(([name]) => name).filter(
      (name) => !sentence.includes(`\`${name}`),
    );

    expect(missing).toEqual([]);
  });
});
