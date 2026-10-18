import { describe, expect, it } from 'vitest';
import { splitShellWords, translateShellLine } from './shell-line.js';

describe('splitShellWords', () => {
  it('should keep a quoted filter together as one word when it has spaces', () => {
    expect(splitShellWords(`feedback export --where 'rating = negative'`)).toEqual([
      'feedback',
      'export',
      '--where',
      'rating = negative',
    ]);
  });

  it('should treat double quotes the same as single quotes when a shell line is read', () => {
    expect(splitShellWords('a "b c" d')).toEqual(['a', 'b c', 'd']);
  });
});

describe('translateShellLine', () => {
  it('should turn a dry run into a where when the line is the one the user pasted', () => {
    expect(translateShellLine('feedback export --dry-run')).toEqual({
      kind: 'steps',
      steps: ['where'],
    });
  });

  it('should drop the jeves prefix when the whole shell line is pasted', () => {
    expect(translateShellLine('jeves feedback export --dry-run')).toEqual({
      kind: 'steps',
      steps: ['where'],
    });
  });

  it('should set the window first and then filter when a dry run has dates and a filter', () => {
    expect(
      translateShellLine(
        `jeves feedback export --dry-run --from 2026-10-07 --to 2026-10-15 --where 'rating = negative'`,
      ),
    ).toEqual({
      kind: 'steps',
      steps: ['window 2026-10-07 2026-10-15', 'where rating = negative'],
    });
  });

  it('should export with the filter when it is not a dry run', () => {
    expect(translateShellLine(`feedback export --where 'env = uat-like'`)).toEqual({
      kind: 'steps',
      steps: ['export where env = uat-like'],
    });
  });

  it('should carry --yes to the window when a shell line has it', () => {
    expect(translateShellLine('feedback export --from 2026-01-01 --to 2026-10-01 --yes')).toEqual({
      kind: 'steps',
      steps: ['window 2026-01-01 2026-10-01 --yes', 'export'],
    });
  });

  it('should open the report after setting the window when feedback report has dates', () => {
    expect(translateShellLine('jeves feedback report --from 2026-10-07 --to 2026-10-15')).toEqual({
      kind: 'steps',
      steps: ['window 2026-10-07 2026-10-15', 'report'],
    });
  });

  it('should map the shell words to session commands when a shell line is pasted', () => {
    expect([
      translateShellLine('feedback fields'),
      translateShellLine(`analyse --where 'rating = negative'`),
    ]).toEqual([
      { kind: 'steps', steps: ['fields'] },
      { kind: 'steps', steps: ['analyse where rating = negative'] },
    ]);
  });

  it('should pass the line through without the prefix when it is config, doctor, docs or compare', () => {
    expect([
      translateShellLine('jeves config set outDir ~/feedback'),
      translateShellLine('jeves doctor'),
      translateShellLine('jeves compare a.xlsx b.xlsx'),
    ]).toEqual([
      { kind: 'steps', steps: ['config set outDir ~/feedback'] },
      { kind: 'steps', steps: ['doctor'] },
      { kind: 'steps', steps: ['compare a.xlsx b.xlsx'] },
    ]);
  });

  it('should explain instead of switching profile when --profile is used, because it would be saved', () => {
    const result = translateShellLine('jeves --profile prod feedback export --dry-run');

    expect(result).toEqual({
      kind: 'say',
      message:
        'A one-off profile is a shell feature. In the session use: use <name> (it becomes the active profile).',
    });
  });

  it('should explain the output folder is a setting when --out is used', () => {
    expect(translateShellLine('feedback export --out ~/x')).toEqual({
      kind: 'say',
      message:
        'The output folder is a setting here: set outDir <folder> (it is saved for later runs too).',
    });
  });

  it('should ask for both dates when only one is given', () => {
    expect(translateShellLine('feedback export --from 2026-10-01')).toEqual({
      kind: 'say',
      message: 'Give both --from and --to, as in: window 2026-10-01 2026-10-13',
    });
  });

  it('should say the session is already open when feedback shell is pasted', () => {
    expect(translateShellLine('feedback shell')).toEqual({
      kind: 'say',
      message: 'You are already in the session.',
    });
  });

  it('should leave a normal filter alone when it does not look like a shell command', () => {
    expect(translateShellLine('rating = negative')).toBeUndefined();
  });

  it('should reject an unknown jeves command by name when the prefix is used', () => {
    expect(translateShellLine('jeves frobnicate')).toEqual({
      kind: 'say',
      message: '"frobnicate" is not an jeves command. Type help.',
    });
  });
});
