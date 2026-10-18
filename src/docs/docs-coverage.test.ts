import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '../cli.js';
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
});
