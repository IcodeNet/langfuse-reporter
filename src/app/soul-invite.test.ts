import { describe, expect, it } from 'vitest';
import { createPalette, stripAnsi } from '../ui/ansi.js';
import { displayWidth } from '../ui/display-width.js';
import { INVITE_GAP_LINES, soulInviteLines } from './soul-invite.js';

function invite(columns: number, unicode = true, color = false): string[] {
  return soulInviteLines({ columns, unicode, paint: createPalette(color) });
}

describe('soulInviteLines', () => {
  it('should start with a gap of empty lines when it is drawn under the hint', () => {
    expect(
      invite(100)
        .slice(0, INVITE_GAP_LINES + 1)
        .map((line) => line === ''),
    ).toEqual([true, true, true, false]);
  });

  it('should keep the gap at three lines or more when the card is drawn', () => {
    expect(INVITE_GAP_LINES).toBeGreaterThanOrEqual(3);
  });

  it.each([120, 80, 50, 36])('should fit a %i column terminal when drawn', (columns) => {
    expect(Math.max(...invite(columns).map((line) => displayWidth(line)))).toBeLessThanOrEqual(
      columns,
    );
  });

  it('should name the soul command and say what the tour is when drawn', () => {
    const text = invite(100).join('\n');

    expect([
      text.includes('soul  a picture tour'),
      text.includes('Meet the soul of this tool.'),
    ]).toEqual([true, true]);
  });

  it('should show the full demo command and say to type it in the normal terminal when drawn', () => {
    const text = invite(100).join('\n');

    expect([text.includes('jeves --demo doctor'), text.includes('normal terminal')]).toEqual([
      true,
      true,
    ]);
  });

  it('should name the ui command and say it opens the setup page when drawn', () => {
    const text = invite(100).join('\n');

    expect(text.includes('ui    the setup page')).toBe(true);
  });

  it('should draw a box with corners and a title when unicode is on', () => {
    const text = invite(100).join('\n');

    expect([text.includes('┌'), text.includes('┘'), text.includes('✦ New here? ✦')]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('should use only plain characters when unicode is off', () => {
    const nonAscii = invite(100, false).filter((line) => Buffer.byteLength(line) !== line.length);

    expect(nonAscii).toEqual([]);
  });

  it('should print no escape codes when colour is off', () => {
    expect(invite(100).join('\n')).toBe(stripAnsi(invite(100).join('\n')));
  });

  it('should say the same words when colour is on as when it is off', () => {
    expect(invite(100, true, true).map((line) => stripAnsi(line))).toEqual(invite(100));
  });

  it('should end with an empty line when the card is drawn', () => {
    expect(invite(100).at(-1)).toBe('');
  });
});
