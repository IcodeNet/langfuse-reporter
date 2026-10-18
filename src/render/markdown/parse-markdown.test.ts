import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './parse-markdown.js';

describe('parseInline', () => {
  it('should mark bold, code and a link when a line has all three', () => {
    expect(parseInline('use **bold** and `code` and [docs](https://x.test)')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'docs', url: 'https://x.test' },
    ]);
  });

  it('should keep the colon as its own text run when it follows a bold word', () => {
    expect(parseInline('**dev**: test')).toEqual([
      { kind: 'bold', text: 'dev' },
      { kind: 'text', text: ': test' },
    ]);
  });

  it('should keep a lone asterisk as text when nothing closes it', () => {
    expect(parseInline('5 * 3 is fifteen')).toEqual([{ kind: 'text', text: '5 * 3 is fifteen' }]);
  });
});

describe('parseMarkdown', () => {
  it('should read a heading with its level when the line starts with hashes', () => {
    expect(parseMarkdown('## Profile')).toEqual([
      { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: 'Profile' }] },
    ]);
  });

  it('should join the lines of one paragraph with a space when there is no blank line', () => {
    expect(parseMarkdown('one\ntwo')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'one two' }] },
    ]);
  });

  it('should keep a fenced block as lines without the fences when the text has one', () => {
    expect(parseMarkdown('```sh\njeves docs\n```')).toEqual([
      { kind: 'code', language: 'sh', lines: ['jeves docs'] },
    ]);
  });

  it('should close a fence that never ends when the text stops', () => {
    expect(parseMarkdown('```\nlost')).toEqual([{ kind: 'code', language: '', lines: ['lost'] }]);
  });

  it('should read one list with each item when the text is a bullet list', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      },
    ]);
  });

  it('should read a numbered list when lines start with numbers', () => {
    expect(parseMarkdown('1. first\n2. second')).toMatchObject([{ kind: 'list', ordered: true }]);
  });

  it('should start a new block after a list when a paragraph follows', () => {
    expect(parseMarkdown('- a\nthen text').map((block) => block.kind)).toEqual([
      'list',
      'paragraph',
    ]);
  });

  it('should return nothing when the text is empty', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});
