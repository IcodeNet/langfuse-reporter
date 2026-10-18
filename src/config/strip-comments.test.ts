import { describe, expect, it } from 'vitest';
import { stripJsonComments } from './strip-comments.js';

describe('stripJsonComments', () => {
  it('should leave the JSON unchanged when it has no comments', () => {
    expect(stripJsonComments('{"a": [1, "b"]}')).toBe('{"a": [1, "b"]}');
  });

  it('should remove the comment and keep the line break when it is a line comment', () => {
    expect(stripJsonComments('{\n  "a": 1 // why\n}')).toBe('{\n  "a": 1 \n}');
  });

  it('should remove the comment and keep its line breaks when it is a block comment', () => {
    expect(stripJsonComments('{ /* one\ntwo */ "a": 1 }')).toBe('{ \n "a": 1 }');
  });

  it('should keep the markers when they sit inside a string', () => {
    expect(stripJsonComments('{"url": "https://x.test/a", "n": "/* not */"}')).toBe(
      '{"url": "https://x.test/a", "n": "/* not */"}',
    );
  });

  it('should keep the string open when it holds an escaped quote', () => {
    expect(stripJsonComments('{"a": "say \\"hi\\" // still text"} // gone')).toBe(
      '{"a": "say \\"hi\\" // still text"} ',
    );
  });

  it('should drop the rest of the text when a block comment is not terminated', () => {
    expect(stripJsonComments('{"a": 1} /* never closed')).toBe('{"a": 1} ');
  });
});
