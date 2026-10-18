import { describe, expect, it } from 'vitest';
import { CREDITS, SESSION_COMMANDS } from './session-commands.js';

describe('CREDITS', () => {
  it('should name the builder and the API it uses when the credits are shown', () => {
    expect(CREDITS).toEqual([
      ['built by', 'Byron Thanopoulos (IcodeNet)'],
      ['contact', 'byronth@gmail.com'],
      ['uses', 'the Langfuse public API'],
    ]);
  });
});

describe('SESSION_COMMANDS', () => {
  it('should list credits when help or suggestions list the commands', () => {
    expect(SESSION_COMMANDS).toContainEqual(['credits', 'who built this tool']);
  });
});
