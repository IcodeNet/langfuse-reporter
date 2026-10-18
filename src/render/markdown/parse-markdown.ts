/** A run of text inside a line, with the style the markdown asked for. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export type Block =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; language: string; lines: string[] }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'rule' };

const FENCE = /^\s*```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const INLINE =
  /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;

/** Splits one line of markdown into styled runs. Anything it does not recognise stays plain text. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: line.slice(last, start) });
    const [, , bold, boldUnderscore, italic, code, linkText, linkUrl] = match;
    if (bold !== undefined || boldUnderscore !== undefined) {
      out.push({ kind: 'bold', text: bold ?? boldUnderscore ?? '' });
    } else if (italic !== undefined) {
      out.push({ kind: 'italic', text: italic });
    } else if (code !== undefined) {
      out.push({ kind: 'code', text: code });
    } else if (linkText !== undefined && linkUrl !== undefined) {
      out.push({ kind: 'link', text: linkText, url: linkUrl });
    }
    last = start + match[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

interface Cursor {
  lines: string[];
  index: number;
}

function takeCode(cursor: Cursor, language: string): Block {
  const body: string[] = [];
  while (cursor.index < cursor.lines.length && !FENCE.test(cursor.lines[cursor.index] ?? '')) {
    body.push(cursor.lines[cursor.index] ?? '');
    cursor.index++;
  }
  cursor.index++;
  return { kind: 'code', language, lines: body };
}

function takeList(cursor: Cursor, ordered: boolean): Block {
  const pattern = ordered ? NUMBERED : BULLET;
  const items: Inline[][] = [];
  while (cursor.index < cursor.lines.length) {
    const match = pattern.exec(cursor.lines[cursor.index] ?? '');
    if (!match) break;
    items.push(parseInline(match[1] ?? ''));
    cursor.index++;
  }
  return { kind: 'list', ordered, items };
}

function startsNewBlock(line: string): boolean {
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line)
  );
}

function takeParagraph(cursor: Cursor): Block {
  const parts: string[] = [];
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index] ?? '';
    if (parts.length > 0 && startsNewBlock(line)) break;
    parts.push(line.trim());
    cursor.index++;
  }
  return { kind: 'paragraph', inlines: parseInline(parts.join(' ')) };
}

/**
 * Reads the small part of markdown the docs and the model use: headings, paragraphs, lists,
 * fenced code, quotes and rules. It never fails; text it does not understand becomes a paragraph.
 */
export function parseMarkdown(markdown: string): Block[] {
  const cursor: Cursor = { lines: markdown.replace(/\r\n?/g, '\n').split('\n'), index: 0 };
  const blocks: Block[] = [];
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index] ?? '';
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    const quote = QUOTE.exec(line);
    if (line.trim() === '') {
      cursor.index++;
    } else if (fence) {
      cursor.index++;
      blocks.push(takeCode(cursor, fence[1] ?? ''));
    } else if (heading) {
      cursor.index++;
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        inlines: parseInline(heading[2] ?? ''),
      });
    } else if (RULE.test(line)) {
      cursor.index++;
      blocks.push({ kind: 'rule' });
    } else if (BULLET.test(line)) {
      blocks.push(takeList(cursor, false));
    } else if (NUMBERED.test(line)) {
      blocks.push(takeList(cursor, true));
    } else if (quote) {
      cursor.index++;
      blocks.push({ kind: 'quote', inlines: parseInline(quote[1] ?? '') });
    } else {
      blocks.push(takeParagraph(cursor));
    }
  }
  return blocks;
}
