import { describe, expect, it } from 'vitest';
import { createPalette, stripAnsi } from '../ui/ansi.js';
import { suggestionRows } from './suggestion-rows.js';
import type { LineHints } from './suggest-line.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const paint = createPalette(false);

function hintsOf(...suggestions: Array<{ insert: string; hint: string }>): LineHints {
  return { replaceFrom: 0, suggestions };
}

describe('suggestionRows', () => {
  it('should draw each suggestion with its hint when the rows are built', () => {
    const rows = suggestionRows({
      hints: hintsOf({ insert: 'rating', hint: 'thumbs' }),
      selected: undefined,
      paint,
    });

    expect(rows).toEqual(['  rating  thumbs']);
  });

  it('should mark the suggestion when it is selected', () => {
    const rows = suggestionRows({
      hints: hintsOf({ insert: 'a', hint: 'one' }, { insert: 'b', hint: 'two' }),
      selected: 1,
      paint,
    });

    expect(rows[1]).toBe('› b  two');
  });

  it('should keep a suggestion on one row when its name has a line break', () => {
    const rows = suggestionRows({
      hints: hintsOf({ insert: 'U-1\n› forged', hint: 'user\tid' }),
      selected: undefined,
      paint,
    });

    expect(rows).toEqual(['  U-1 › forged  user id']);
  });

  it('should strip escape sequences when a suggestion name came from Langfuse', () => {
    const rows = suggestionRows({
      hints: hintsOf({ insert: `U-1${ESC}[2J${ESC}]0;pwned${BEL}`, hint: 'user' }),
      selected: undefined,
      paint,
    });

    expect(rows.join('')).not.toContain(ESC);
    expect(rows.join('')).toContain('U-1');
    expect(rows.join('')).not.toContain('pwned');
  });

  it('should strip escape sequences when a hint or the status message contains them', () => {
    const rows = suggestionRows({
      hints: {
        replaceFrom: 0,
        suggestions: [{ insert: 'x', hint: `h${ESC}[H` }],
        message: { kind: 'info', text: `m${ESC}[2J` },
      },
      selected: undefined,
      paint,
    });

    expect(stripAnsi(rows.join(''))).not.toContain(ESC);
  });

  it('should line the hints up when a suggestion name is wide', () => {
    const rows = suggestionRows({
      hints: hintsOf({ insert: '日本', hint: 'wide' }, { insert: 'ab', hint: 'narrow' }),
      selected: undefined,
      paint,
    });

    expect(rows).toEqual(['  日本  wide', '  ab    narrow']);
  });

  it('should say how many suggestions are hidden when there are more than fit', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ insert: `s${index}`, hint: 'h' }));

    const rows = suggestionRows({ hints: hintsOf(...many), selected: undefined, paint });

    expect(rows.at(-1)).toBe('  ↓ 4 more');
  });
});
