import { describe, expect, it } from 'vitest';
import { canDrawBoxes } from './run-soul.js';

describe('canDrawBoxes', () => {
  it.each([
    [true, { LANG: 'en_GB.UTF-8', TERM: 'xterm-256color' }, true],
    [true, { LC_ALL: 'C.utf8', TERM: 'xterm' }, true],
    [false, { LANG: 'en_GB.UTF-8', TERM: 'xterm' }, false],
    [true, { LANG: 'C', TERM: 'xterm' }, false],
    [true, {}, false],
    [true, { LANG: 'en_GB.UTF-8', TERM: 'linux' }, false],
    [true, { LANG: 'en_GB.UTF-8', TERM: 'dumb' }, false],
  ])(
    'should answer drawing boxes as %3$s when interactive is %1$s and the environment is %2$j',
    (interactive, env, expected) => {
      expect(canDrawBoxes(interactive, env)).toBe(expected);
    },
  );
});
