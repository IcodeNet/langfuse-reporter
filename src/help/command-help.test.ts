import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';
import { COMMAND_NAMES } from '../session/session-commands.js';
import {
  COMMAND_HELP,
  DOCS_MODE_HELP,
  MAX_HELP_LINES,
  MAX_HELP_WIDTH,
  SESSION_HELP,
} from './command-help.js';

function pathsOf(command: ReturnType<typeof buildProgram>, prefix: string[] = []): string[] {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    return [path.join(' '), ...pathsOf(child, path)];
  });
}

const ALL_CARDS = [
  ...Object.entries(COMMAND_HELP).map(([name, lines]) => [`jeves ${name}`.trim(), lines] as const),
  ...Object.entries(SESSION_HELP).map(([name, lines]) => [`session ${name}`, lines] as const),
  ['docs chat mode', DOCS_MODE_HELP] as const,
];

describe('help cards', () => {
  it.each(ALL_CARDS)(
    'should have between 3 and 10 lines when it is the card for %s',
    (_name, lines) => {
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(MAX_HELP_LINES);
    },
  );

  it.each(ALL_CARDS)(
    'should fit an 80 column terminal when it is the card for %s',
    (_name, lines) => {
      const tooWide = lines.filter((line) => line.length > MAX_HELP_WIDTH);

      expect(tooWide).toEqual([]);
    },
  );

  it('should cover every one-shot command and subcommand when the program is built', () => {
    const paths = ['', ...pathsOf(buildProgram(['node', 'jeves']))];

    expect(paths.filter((path) => !(path in COMMAND_HELP))).toEqual([]);
  });

  it('should cover every session command when the session knows it', () => {
    const named = [...COMMAND_NAMES].filter((name) => !['quit', '/credits', '?'].includes(name));

    expect(named.filter((name) => !(name in SESSION_HELP))).toEqual([]);
  });

  it('should print exactly the card when a one-shot command is asked for --help', () => {
    const program = buildProgram(['node', 'jeves']);
    const exportCommand = program.commands
      .find((c) => c.name() === 'feedback')
      ?.commands.find((c) => c.name() === 'export');

    expect(exportCommand?.helpInformation().trimEnd().split('\n')).toEqual([
      ...(COMMAND_HELP['feedback export'] ?? []),
    ]);
  });
});
