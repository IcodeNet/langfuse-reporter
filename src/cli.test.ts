import { describe, expect, it } from 'vitest';
import { buildProgram, explainUsageError, packageVersion } from './cli.js';

describe('explainUsageError', () => {
  it('should name the closest command and the help command when a command is mistyped', () => {
    expect(
      explainUsageError("error: unknown command 'doctr'\n(run with --help to see usage)\n"),
    ).toBe(
      'error: unknown command \'doctr\' Did you mean "doctor" or "docs"?\nSee the commands with: jeves --help\n',
    );
  });

  it('should point to the help command when the word is too far from any command', () => {
    expect(explainUsageError("error: unknown command 'zzzzzzzz'\n")).toBe(
      "error: unknown command 'zzzzzzzz'\nSee the commands with: jeves --help\n",
    );
  });

  it('should name the unknown command when commander reports too many arguments', () => {
    expect(
      explainUsageError('error: too many arguments. Expected 0 arguments but got 1: bogus.\n'),
    ).toBe(
      'error: too many arguments. Expected 0 arguments but got 1: bogus.\nSee the commands with: jeves --help\n',
    );
  });

  it('should point to the help of the command when a required argument is missing', () => {
    expect(explainUsageError("error: missing required argument 'before'\n")).toBe(
      "error: missing required argument 'before'\nSee how it is used with: jeves <command> --help\n",
    );
  });

  it('should leave the message as it is when it is not about a command or an argument', () => {
    expect(explainUsageError("error: option '--from <iso>' argument missing\n")).toBe(
      "error: option '--from <iso>' argument missing\n",
    );
  });
});

describe('packageVersion', () => {
  it('should be a three part version number when read from package.json', () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('feedback export options', () => {
  it('should offer --format when the export command is built', () => {
    const feedback = buildProgram([]).commands.find((command) => command.name() === 'feedback');
    const exportCommand = feedback?.commands.find((command) => command.name() === 'export');

    expect(exportCommand?.options.map((option) => option.long)).toContain('--format');
  });

  it('should not offer --format when the compare command is built', () => {
    const compare = buildProgram([]).commands.find((command) => command.name() === 'compare');

    expect(compare?.options.map((option) => option.long)).not.toContain('--format');
  });
});
