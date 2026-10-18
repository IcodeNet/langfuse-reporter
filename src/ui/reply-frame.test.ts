import { describe, expect, it } from 'vitest';
import { createPalette, stripAnsi } from './ansi.js';
import { displayWidth } from './display-width.js';
import { frameReply } from './reply-frame.js';

const PLAIN = createPalette(false).gold;

describe('frameReply', () => {
  it('should draw a titled top line, the text, and a closing line when unicode is on', () => {
    expect(
      frameReply('Jeves · docs', 'one\ntwo', { columns: 40, border: PLAIN, unicode: true }),
    ).toBe(
      [
        '╭─ Jeves · docs ──────────────────────╮',
        'one',
        'two',
        '╰─────────────────────────────────────╯',
      ].join('\n'),
    );
  });

  it('should use plain characters when unicode is off', () => {
    const framed = frameReply('Docs', 'x', { columns: 30, border: PLAIN, unicode: false });

    expect(framed.split('\n').filter((line) => Buffer.byteLength(line) !== line.length)).toEqual(
      [],
    );
  });

  it.each([120, 80, 40, 24])(
    'should make the top and bottom lines fit when the terminal has %i columns',
    (columns) => {
      const lines = frameReply('A title', 'x', { columns, border: PLAIN, unicode: true }).split(
        '\n',
      );

      expect([
        displayWidth(lines[0] ?? '') <= columns,
        displayWidth(lines.at(-1) ?? '') <= columns,
      ]).toEqual([true, true]);
    },
  );

  it('should leave the sides open when the reply is copied', () => {
    const lines = frameReply('T', 'hello world', {
      columns: 40,
      border: PLAIN,
      unicode: true,
    }).split('\n');

    expect(lines[1]).toBe('hello world');
  });

  it('should drop trailing blank lines when the text ends with them', () => {
    const lines = frameReply('T', 'a\n\n\n', { columns: 30, border: PLAIN, unicode: true }).split(
      '\n',
    );

    expect(lines).toHaveLength(3);
  });

  it('should colour only the frame lines when colour is on', () => {
    const coloured = frameReply('T', 'body', {
      columns: 30,
      border: createPalette(true).gold,
      unicode: true,
    });

    expect(stripAnsi(coloured).split('\n')[1]).toBe('body');
  });
});
