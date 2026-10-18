import { describe, expect, it } from 'vitest';
import {
  displayWidth,
  truncateToWidth,
  wrapAtBreaks,
  wrapToWidth,
  wrapWords,
} from './display-width.js';

describe('displayWidth', () => {
  it('should count one cell per character when the text is plain', () => {
    expect(displayWidth('hello')).toBe(5);
  });

  it('should count two cells when the character is a wide East Asian one', () => {
    expect(displayWidth('日本語')).toBe(6);
  });

  it('should count two cells when the character is an emoji', () => {
    expect(displayWidth('📊')).toBe(2);
  });

  it('should count one two-cell character when an emoji sequence is joined', () => {
    expect(displayWidth('👨‍👩‍👧')).toBe(2);
  });

  it('should count one cell when a letter has a combining accent', () => {
    expect(displayWidth('e\u0301')).toBe(1);
  });

  it('should count nothing when a zero width joiner stands alone', () => {
    expect(displayWidth('\u200d')).toBe(0);
  });

  it('should count zero when the string is empty', () => {
    expect(displayWidth('')).toBe(0);
  });

  it('should count one cell when the letter is a precomposed accented one', () => {
    expect(displayWidth('£é')).toBe(2);
  });
});

describe('truncateToWidth', () => {
  it('should leave the text as it is when it fits', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello');
  });

  it('should cut plain text and end with an ellipsis when it is wider than the limit', () => {
    const cut = truncateToWidth('hello world', 6);

    expect(cut).toBe('hello…');
    expect(displayWidth(cut)).toBeLessThanOrEqual(6);
  });

  it('should never exceed the width when the text has wide characters', () => {
    const cut = truncateToWidth('日本語のテキスト', 7);

    expect(displayWidth(cut)).toBeLessThanOrEqual(7);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('should not split an emoji in half when the cut falls inside it', () => {
    const cut = truncateToWidth('ab📊cd', 4);

    expect(cut).toBe('ab…');
  });

  it('should not leave a combining mark without its letter when the cut falls before the mark', () => {
    const cut = truncateToWidth('e\u0301e\u0301e\u0301e\u0301', 3);

    expect(cut).toBe('e\u0301e\u0301…');
  });

  it('should return only the ellipsis when the width is one', () => {
    expect(truncateToWidth('hello', 1)).toBe('…');
  });

  it('should return only the ellipsis when the width is zero rather than overflow', () => {
    expect(truncateToWidth('hello', 0)).toBe('…');
  });
});

describe('wrapToWidth', () => {
  it('should keep the text on one line when it is short', () => {
    expect(wrapToWidth('hello', 10)).toEqual(['hello']);
  });

  it('should split the text into pieces holding every character when it is long', () => {
    expect(wrapToWidth('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('should not split a wide character across two lines when the line breaks inside it', () => {
    expect(wrapToWidth('ab日本', 3)).toEqual(['ab', '日', '本']);
  });
});

describe('wrapWords', () => {
  it('should break between words and never inside one when the line is too short', () => {
    expect(wrapWords('a profile is an address', 10)).toEqual(['a profile', 'is an', 'address']);
  });

  it('should split the word when it is wider than the line', () => {
    expect(wrapWords('abcdefgh ok', 4)).toEqual(['abcd', 'efgh', 'ok']);
  });
});

describe('wrapAtBreaks', () => {
  it('should cut a path between folders when it is too wide for the line', () => {
    expect(wrapAtBreaks('/home/user/repos/dev.env', 20)).toEqual(['/home/user/repos/', 'dev.env']);
  });

  it('should keep every character when a word has no break point', () => {
    expect(wrapAtBreaks('abcdefghij', 4).join('')).toBe('abcdefghij');
  });

  it('should leave the line alone when it is short', () => {
    expect(wrapAtBreaks('short', 20)).toEqual(['short']);
  });
});
