import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '../cli.js';
import { COMMAND_HELP } from './command-help.js';

function leaves(
  command: Command,
  prefix: string[] = [],
): Array<{ path: string; options: string[] }> {
  const here = [...prefix, command.name()];
  const own = command.options.flatMap((option) => (option.long ? [option.long] : []));
  const below = command.commands.flatMap((child) => leaves(child, here));
  return [{ path: here.slice(1).join(' '), options: own }, ...below];
}

describe('help cards', () => {
  const program = buildProgram(['node', 'jeves']);

  it('should name every option of a command on its own card when the card exists', () => {
    const missing = leaves(program).flatMap(({ path, options }) => {
      const card = COMMAND_HELP[path]?.join('\n');
      if (card === undefined || path === '') return [];
      return options
        .filter((option) => !card.includes(option.replace('--no-', '--no-')))
        .map((option) => `${path}: ${option}`);
    });

    expect(missing).toEqual([]);
  });
});
