import { describe, expect, it } from 'vitest';
import { stripControlCharacters, toOneLine } from './untrusted-text.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('toOneLine', () => {
  it('should turn tabs and line breaks into single spaces when text is made one line', () => {
    expect(toOneLine('a\tb\n\nc')).toBe('a b c');
  });

  it('should still remove escape sequences when text is made one line', () => {
    expect(toOneLine(`${ESC}[2Jhi`)).toBe('hi');
  });
});

describe('stripControlCharacters', () => {
  it('should leave the text alone when it is ordinary text, tabs and newlines', () => {
    expect(stripControlCharacters('Rate is 4.1%\tgood\nnext line')).toBe(
      'Rate is 4.1%\tgood\nnext line',
    );
  });

  it('should keep the characters when they are accents, emoji or other printable ones', () => {
    expect(stripControlCharacters('£75,000 — naïve 📊')).toBe('£75,000 — naïve 📊');
  });

  it('should remove the sequence when it sets a colour', () => {
    expect(stripControlCharacters(`${ESC}[31mred${ESC}[0m`)).toBe('red');
  });

  it('should remove the sequence when it clears the screen or moves the cursor', () => {
    expect(stripControlCharacters(`a${ESC}[2J${ESC}[Hb${ESC}[10;20Hc`)).toBe('abc');
  });

  it('should remove the sequence when it sets the window title and ends with BEL', () => {
    expect(stripControlCharacters(`x${ESC}]0;pwned${BEL}y`)).toBe('xy');
  });

  it('should remove the sequence when it is a hyperlink ended by ESC backslash', () => {
    expect(
      stripControlCharacters(`${ESC}]8;;https://evil.test${ESC}\\click${ESC}]8;;${ESC}\\`),
    ).toBe('click');
  });

  it('should remove the character when it is a bare control such as carriage return, backspace or BEL', () => {
    expect(stripControlCharacters(`fake\rreal${String.fromCharCode(8)}${BEL}`)).toBe('fakereal');
  });

  it('should remove the character when it is a C1 control', () => {
    expect(stripControlCharacters(`a${String.fromCharCode(0x9b)}2Jb`)).toBe('a2Jb');
  });

  it('should leave no escape character behind when sequences are broken or nested', () => {
    const hostile = `${ESC}${ESC}[${ESC}]${ESC}[31${ESC}x`;

    expect(stripControlCharacters(hostile)).not.toContain(ESC);
  });
});
