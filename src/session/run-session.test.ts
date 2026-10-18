import { describe, expect, it } from 'vitest';
import {
  CLEAR_SCREEN,
  interactiveTerminalProblem,
  looksLikeMistypedCommand,
  parseExportArgument,
  settingNeedsReload,
  takeLoadFlags,
  promptFor,
} from './run-session.js';

describe('parseExportArgument', () => {
  it('should export everything when nothing follows export', () => {
    expect(parseExportArgument('')).toBeUndefined();
  });

  it('should export everything when only spaces follow export', () => {
    expect(parseExportArgument('   ')).toBeUndefined();
  });

  it('should return the filter text when where is followed by a filter', () => {
    expect(parseExportArgument('where rating = negative')).toBe('rating = negative');
  });

  it('should accept the filter when WHERE is in capitals and spaces are repeated', () => {
    expect(parseExportArgument('WHERE   rating = negative')).toBe('rating = negative');
  });

  it('should refuse where when no filter follows it', () => {
    expect(parseExportArgument('where')).toBeNull();
  });

  it('should refuse the filter when it is written without the where keyword', () => {
    expect(parseExportArgument('rating = negative')).toBeNull();
  });

  it('should refuse where when only spaces follow it', () => {
    expect(parseExportArgument('where    ')).toBeNull();
  });
});

describe('takeLoadFlags', () => {
  it('should find no flags when the words carry none', () => {
    expect(takeLoadFlags(['2026-10-01', '2026-10-13'])).toEqual({
      flags: { yes: false, forceLarge: false },
      rest: ['2026-10-01', '2026-10-13'],
    });
  });

  it('should take --yes out of the words when it is given', () => {
    expect(takeLoadFlags(['2026-10-01', '--yes', '2026-10-13'])).toEqual({
      flags: { yes: true, forceLarge: false },
      rest: ['2026-10-01', '2026-10-13'],
    });
  });

  it('should take --force-large out of the words when it is given', () => {
    expect(takeLoadFlags(['--force-large']).flags).toEqual({ yes: false, forceLarge: true });
  });
});

describe('settingNeedsReload', () => {
  it.each(['profile.baseUrl', 'profile.envFile'])(
    'should reload the ratings when %s changes because they came from the old one',
    (key) => {
      expect(settingNeedsReload(key)).toBe(true);
    },
  );

  it.each([
    'conventions.turnName',
    'conventions.ratingScore',
    'conventions.reasonScorePrefix',
    'conventions.reasons',
    'conventions.yesValues',
  ])('should reload the ratings when %s changes because it shapes how rows are built', (key) => {
    expect(settingNeedsReload(key)).toBe(true);
  });

  it.each(['conventions.assistantName', 'conventions.passLabel', 'conventions.failLabel'])(
    'should keep the loaded ratings when %s changes because it is only a label',
    (key) => {
      expect(settingNeedsReload(key)).toBe(false);
    },
  );

  it.each(['outDir', 'llm.provider', 'llm.model', 'llm.baseUrl'])(
    'should keep the loaded ratings when %s changes because they do not depend on it',
    (key) => {
      expect(settingNeedsReload(key)).toBe(false);
    },
  );
});

describe('interactiveTerminalProblem', () => {
  it('should find no problem when input and output are both terminals', () => {
    expect(interactiveTerminalProblem({ stdinIsTty: true, stdoutIsTty: true })).toBeUndefined();
  });

  it('should explain the problem and name a command to use instead when input is piped', () => {
    expect(interactiveTerminalProblem({ stdinIsTty: false, stdoutIsTty: true })).toContain(
      'jeves feedback export',
    );
  });

  it('should refuse when output is redirected so escape codes never reach a file', () => {
    expect(interactiveTerminalProblem({ stdinIsTty: true, stdoutIsTty: false })).toContain(
      'needs a terminal',
    );
  });
});

describe('CLEAR_SCREEN', () => {
  it('should clear the screen, the scrollback and move the cursor home when the clear command runs', () => {
    expect(CLEAR_SCREEN).toBe('\u001b[2J\u001b[3J\u001b[H');
  });
});

describe('promptFor', () => {
  it('should name the profile in the prompt when the session is open', () => {
    const state = { resolved: { profileName: 'prod' } } as Parameters<typeof promptFor>[0];

    expect(promptFor(state)).toBe('jeves[prod]> ');
  });
});

describe('looksLikeMistypedCommand', () => {
  it.each([
    ['bogus', true],
    ['sould', true],
    ['rating', false],
    ['Category', false],
    ['env', false],
    ['rating = negative', false],
    ['rating', false],
    ['', false],
  ])(
    'should judge the line %j as %s when it is checked for a mistyped command',
    (line, expected) => {
      expect(looksLikeMistypedCommand(line)).toBe(expected);
    },
  );
});
