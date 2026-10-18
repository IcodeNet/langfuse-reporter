import { describe, expect, it } from 'vitest';
import { stripAnsi, visibleWidth } from './ansi.js';
import { renderBox } from './box.js';

const plain = (text: string): string => text;

describe('renderBox', () => {
  it('should draw a titled unicode box with the text inside when unicode is on', () => {
    const rows = renderBox('Docs', ['hello'], { width: 20, border: plain, unicode: true });

    expect(rows).toEqual(['┌─ Docs ───────────┐', '│ hello            │', '└──────────────────┘']);
  });

  it('should fall back to plain characters when unicode is off', () => {
    const rows = renderBox('Docs', ['hello'], { width: 20, border: plain, unicode: false });

    expect(rows[0]).toBe('+- Docs -----------+');
  });

  it('should make every row exactly the box width when a line has to wrap', () => {
    const rows = renderBox('T', ['word '.repeat(30)], { width: 30, border: plain, unicode: true });

    expect(rows.map((row) => visibleWidth(row))).toEqual(rows.map(() => 30));
  });

  it('should colour only the border when a border colour is given', () => {
    const red = (text: string): string => `\u001b[31m${text}\u001b[0m`;
    const rows = renderBox('T', ['hi'], { width: 12, border: red, unicode: true });

    expect([rows[1]?.includes('\u001b[31m'), stripAnsi(rows[1] ?? '')]).toEqual([
      true,
      '│ hi       │',
    ]);
  });
});
