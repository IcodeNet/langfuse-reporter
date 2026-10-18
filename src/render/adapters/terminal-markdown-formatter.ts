import { createPalette, type Palette } from '../../ui/ansi.js';
import { displayWidth, wrapAtBreaks } from '../../ui/display-width.js';
import { stripControlCharacters } from '../../ui/untrusted-text.js';
import { parseMarkdown, type Block, type Inline } from '../markdown/parse-markdown.js';
import type { FormatContext, TextFormatter } from '../text-formatter.js';

const INDENT = '  ';
const BULLET = '•';
const MIN_WIDTH = 20;

/**
 * A piece of a line: `plain` is what it measures, `painted` is what it prints. `glued` means no
 * space sits before it, as in the colon after a bold word.
 */
interface Word {
  plain: string;
  painted: string;
  glued: boolean;
}

function paintInline(inline: Inline, paint: Palette): string {
  switch (inline.kind) {
    case 'bold':
      return paint.bold(inline.text);
    case 'italic':
      return paint.cream(inline.text);
    case 'code':
      return paint.cyan(inline.text);
    case 'link':
      return `${paint.cyan(inline.text)} ${paint.dim(`(${inline.url})`)}`;
    default:
      return inline.text;
  }
}

function plainInline(inline: Inline): string {
  return inline.kind === 'link' ? `${inline.text} (${inline.url})` : inline.text;
}

/**
 * Splits styled runs into words. A word is glued to the one before it only when the source had no
 * space between them, so `**dev**:` keeps its colon and `use `code`` keeps its space.
 */
function toWords(inlines: Inline[], paint: Palette): Word[] {
  const words: Word[] = [];
  let spaceBefore = true;
  for (const inline of inlines) {
    const text = plainInline(inline);
    if (inline.kind === 'link' || inline.kind === 'code') {
      words.push({
        plain: text,
        painted: paintInline(inline, paint),
        glued: !spaceBefore && words.length > 0,
      });
      spaceBefore = false;
      continue;
    }
    const pieces = text.split(/(\s+)/);
    for (const piece of pieces) {
      if (piece === '') continue;
      if (/^\s+$/.test(piece)) {
        spaceBefore = true;
        continue;
      }
      words.push({
        plain: piece,
        painted: paintInline({ ...inline, text: piece }, paint),
        glued: !spaceBefore && words.length > 0,
      });
      spaceBefore = false;
    }
  }
  return words;
}

/** Fits the words into lines no wider than `width`, keeping each word whole. */
function wrapWordsWithPaint(words: Word[], width: number): string[] {
  const lines: string[] = [];
  let line = '';
  let used = 0;
  for (const word of words) {
    const size = displayWidth(word.plain);
    const gap = used === 0 || word.glued ? 0 : 1;
    if (used > 0 && used + gap + size > width) {
      lines.push(line);
      line = '';
      used = 0;
    }
    const space = used === 0 || word.glued ? '' : ' ';
    line += `${space}${word.painted}`;
    used += space.length + size;
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function hanging(lines: string[], first: string, rest: string): string[] {
  return lines.map((line, index) => `${index === 0 ? first : rest}${line}`);
}

function renderBlock(block: Block, width: number, paint: Palette): string[] {
  switch (block.kind) {
    case 'heading': {
      const text = block.inlines.map(plainInline).join('');
      const painted = block.level <= 1 ? paint.gold(text) : paint.amber(paint.bold(text));
      return [painted];
    }
    case 'paragraph':
      return wrapWordsWithPaint(toWords(block.inlines, paint), width);
    case 'quote':
      return hanging(
        wrapWordsWithPaint(toWords(block.inlines, paint), width - 2),
        paint.dim('│ '),
        paint.dim('│ '),
      );
    case 'rule':
      return [paint.dim('─'.repeat(Math.min(width, 40)))];
    case 'code':
      return block.lines.flatMap((line) =>
        wrapAtBreaks(line, Math.max(MIN_WIDTH, width - INDENT.length)).map(
          (piece) => `${INDENT}${paint.cyan(piece)}`,
        ),
      );
    case 'list':
      return block.items.flatMap((item, index) => {
        const marker = block.ordered ? `${index + 1}.` : BULLET;
        const lead = `${INDENT}${paint.amber(marker)} `;
        const pad = ' '.repeat(INDENT.length + displayWidth(marker) + 1);
        const room = Math.max(MIN_WIDTH, width - pad.length);
        return hanging(wrapWordsWithPaint(toWords(item, paint), room), lead, pad);
      });
  }
}

/**
 * Draws markdown as styled terminal text: headings, bullets, code, quotes, and prose wrapped to
 * the terminal width. Untrusted text is stripped of escape sequences before it is parsed, so the
 * only escapes in the output are the ones this adapter adds.
 */
export const terminalMarkdownFormatter: TextFormatter = {
  name: 'terminal-markdown',
  format(text: string, { columns, styled }: FormatContext): string {
    const paint = createPalette(styled);
    const width = Math.max(MIN_WIDTH, columns - 2);
    const blocks = parseMarkdown(stripControlCharacters(text));
    const out: string[] = [];
    blocks.forEach((block, index) => {
      if (index > 0) out.push('');
      out.push(...renderBlock(block, width, paint));
    });
    return out.join('\n');
  },
};
