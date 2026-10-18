import { QueryError } from './types.js';

type TokenKind = 'word' | 'string' | 'op' | 'lparen' | 'rparen' | 'comma';

export interface Token {
  kind: TokenKind;
  /** Word/string text without quotes; operators as written. */
  text: string;
  start: number;
  end: number;
}

const WORD_CHAR = /[A-Za-z0-9_.:+\-/@]/;

/** Throws QueryError only for an unterminated string; every other character is tokenised or rejected. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch, start: i, end: ++i });
    } else if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch, start: i, end: ++i });
    } else if (ch === ',') {
      tokens.push({ kind: 'comma', text: ch, start: i, end: ++i });
    } else if (ch === '"' || ch === "'") {
      const close = input.indexOf(ch, i + 1);
      if (close === -1) throw new QueryError('Unterminated quoted text', i);
      tokens.push({ kind: 'string', text: input.slice(i + 1, close), start: i, end: close + 1 });
      i = close + 1;
    } else if ('=!<>'.includes(ch)) {
      const two = input.slice(i, i + 2);
      const text = two === '!=' || two === '>=' || two === '<=' ? two : ch;
      if (text === '!') throw new QueryError('Use != for "not equal"', i);
      tokens.push({ kind: 'op', text, start: i, end: i + text.length });
      i += text.length;
    } else if (WORD_CHAR.test(ch)) {
      const start = i;
      while (i < input.length && WORD_CHAR.test(input.charAt(i))) i++;
      tokens.push({ kind: 'word', text: input.slice(start, i), start, end: i });
    } else {
      throw new QueryError(`Unexpected character "${ch}"`, i);
    }
  }
  return tokens;
}
