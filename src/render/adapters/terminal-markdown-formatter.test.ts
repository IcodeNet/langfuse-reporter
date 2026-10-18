import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../../ui/ansi.js';
import { passthroughFormatter } from './passthrough-formatter.js';
import { terminalMarkdownFormatter } from './terminal-markdown-formatter.js';
import { pickFormatter } from '../pick-formatter.js';

const ESC = String.fromCharCode(27);
const PLAIN = { columns: 60, styled: false };
const STYLED = { columns: 60, styled: true };

describe('terminalMarkdownFormatter', () => {
  it('should draw a bullet and remove the markdown marks when the list has bold text', () => {
    const text = terminalMarkdownFormatter.format('- **dev**: the test project', PLAIN);

    expect(text).toBe('  • dev: the test project');
  });

  it('should keep a space before inline code and none before a colon when bold text is followed by one', () => {
    const text = terminalMarkdownFormatter.format('run **dev**: use `docs` now', PLAIN);

    expect(text).toBe('run dev: use docs now');
  });

  it('should number list items when the list is ordered', () => {
    expect(terminalMarkdownFormatter.format('1. one\n2. two', PLAIN)).toBe('  1. one\n  2. two');
  });

  it('should print a heading without the hashes when the text has one', () => {
    expect(terminalMarkdownFormatter.format('## Env file', PLAIN)).toBe('Env file');
  });

  it('should indent a code block and drop the fences when the text has a fenced block', () => {
    const text = terminalMarkdownFormatter.format('```sh\njeves docs\n```', PLAIN);

    expect(text).toBe('  jeves docs');
  });

  it('should not pad a short code line with trailing spaces when the block has a longer line', () => {
    const text = terminalMarkdownFormatter.format('```\nshort\na much longer line\n```', PLAIN);

    expect(text.split('\n')[0]).toBe('  short');
  });

  it('should wrap a code line without losing any of it when it is wider than the terminal', () => {
    const long = 'jeves config set profile.envFile /home/user/langfuse-reporter/x.env';
    const text = terminalMarkdownFormatter.format(`\`\`\`\n${long}\n\`\`\``, {
      columns: 40,
      styled: false,
    });

    expect(
      text
        .split('\n')
        .map((line) => line.replace(/^ {2}/, ''))
        .join(''),
    ).toBe(long);
  });

  it('should wrap a long paragraph at word boundaries when it is wider than the terminal', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu';
    const lines = terminalMarkdownFormatter
      .format(words, { columns: 30, styled: false })
      .split('\n');

    expect(lines.every((line) => line.length <= 28)).toBe(true);
  });

  it('should keep every word when a paragraph is wrapped', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu';
    const out = terminalMarkdownFormatter.format(words, { columns: 30, styled: false });

    expect(out.split(/\s+/).join(' ')).toBe(words);
  });

  it('should show a link with its address when the text has one', () => {
    expect(terminalMarkdownFormatter.format('[docs](https://x.test)', PLAIN)).toBe(
      'docs (https://x.test)',
    );
  });

  it('should leave a blank line when two blocks follow each other', () => {
    expect(terminalMarkdownFormatter.format('# A\n\ntext', PLAIN)).toBe('A\n\ntext');
  });

  it('should add colour only when styled output is asked for', () => {
    const styled = terminalMarkdownFormatter.format('**bold**', STYLED);

    expect([styled.includes(ESC), stripAnsi(styled)]).toEqual([true, 'bold']);
  });

  it('should strip an escape sequence when model text contains one', () => {
    const text = terminalMarkdownFormatter.format(`hello${ESC}[2Jworld`, PLAIN);

    expect(text).toBe('helloworld');
  });

  it('should strip an escape sequence when it is hidden in a heading', () => {
    expect(terminalMarkdownFormatter.format(`# Title${ESC}]0;pwned\u0007`, PLAIN)).toBe('Title');
  });
});

describe('passthroughFormatter', () => {
  it('should return the text exactly as it came when the plain formatter is used', () => {
    expect(passthroughFormatter.format('## keep **this**', PLAIN)).toBe('## keep **this**');
  });

  it('should strip an escape sequence when model text contains one', () => {
    expect(passthroughFormatter.format(`hello ${ESC}]0;pwned\u0007${ESC}[2J world`, PLAIN)).toBe(
      'hello  world',
    );
  });

  it('should keep line breaks when it strips control characters', () => {
    expect(passthroughFormatter.format('one\ntwo', PLAIN)).toBe('one\ntwo');
  });
});

describe('pickFormatter', () => {
  it('should pick the markdown adapter when the output is styled', () => {
    expect(pickFormatter({ styled: true }).name).toBe('terminal-markdown');
  });

  it('should pick the passthrough adapter when the output is a pipe', () => {
    expect(pickFormatter({ styled: false }).name).toBe('passthrough');
  });
});
