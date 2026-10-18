const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** True for the East Asian wide and fullwidth ranges and for emoji presentation, which take two cells. */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** Combining marks, zero width joiners and variation selectors take no cell of their own. */
function isZeroWidth(codePoint: number): boolean {
  return (
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0x2060
  );
}

/** Cells one user-visible character (a grapheme: a letter with its accents, or a whole emoji sequence) occupies. */
function graphemeWidth(grapheme: string): number {
  const points = Array.from(grapheme).map((character) => character.codePointAt(0) ?? 0);
  const visible = points.filter((point) => !isZeroWidth(point));
  if (visible.length === 0) return 0;
  return visible.some(isWide) ? 2 : 1;
}

/** How many terminal cells the text takes. Plain text without escapes is assumed. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(text)) width += graphemeWidth(segment);
  return width;
}

/** Cuts the text to at most `width` cells without splitting a character, ending in "…" when it was cut. */
export function truncateToWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let used = 0;
  let out = '';
  for (const { segment } of segmenter.segment(text)) {
    const next = graphemeWidth(segment);
    if (used + next > Math.max(0, width - 1)) break;
    out += segment;
    used += next;
  }
  return `${out}…`;
}

/** Splits the text into pieces of at most `width` cells without splitting a character; nothing is dropped. */
export function wrapToWidth(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const pieces: string[] = [];
  let current = '';
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const next = graphemeWidth(segment);
    if (used + next > limit && current !== '') {
      pieces.push(current);
      current = '';
      used = 0;
    }
    current += segment;
    used += next;
  }
  pieces.push(current);
  return pieces;
}

/** Wraps prose at spaces so words stay whole; a single word wider than `width` is split by `wrapToWidth`. */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line === '' ? word : `${line} ${word}`;
    if (displayWidth(joined) <= width) {
      line = joined;
      continue;
    }
    if (line !== '') lines.push(line);
    const pieces = wrapToWidth(word, width);
    lines.push(...pieces.slice(0, -1));
    line = pieces.at(-1) ?? '';
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/**
 * Wraps a line of code or a path: it breaks after a space or a slash when it can, so a path is cut
 * between folders and not in the middle of a name. Nothing is dropped; a piece with no break point
 * is split by width.
 */
export function wrapAtBreaks(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const lines: string[] = [];
  let rest = text;
  while (displayWidth(rest) > limit) {
    const head = wrapToWidth(rest, limit)[0] ?? '';
    const breakAt = Math.max(head.lastIndexOf(' '), head.lastIndexOf('/'));
    const cut = breakAt > 0 ? breakAt + 1 : head.length;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  lines.push(rest);
  return lines;
}
