import { padVisible } from './ansi.js';
import { wrapWords } from './display-width.js';

type Paint = (text: string) => string;

export interface BoxOptions {
  /** Outer width in characters, borders included. */
  width: number;
  /** Colours the border and the title; identity when colour is off. */
  border: Paint;
  /** True draws ┌─┐ lines; false falls back to + - | so a plain log still reads as a box. */
  unicode: boolean;
}

const FRAMES = {
  unicode: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
} as const;

/** A titled box of wrapped text lines; every row is exactly `width` wide. */
export function renderBox(title: string, lines: readonly string[], options: BoxOptions): string[] {
  const frame = options.unicode ? FRAMES.unicode : FRAMES.ascii;
  const inner = Math.max(1, options.width - 4);
  const heading = ` ${title} `;
  const top = `${frame.tl}${frame.h}${heading}${frame.h.repeat(Math.max(0, options.width - 3 - heading.length))}${frame.tr}`;
  const body = lines.flatMap((line) => wrapWords(line, inner));
  const rows = body.map(
    (line) => `${options.border(frame.v)} ${padVisible(line, inner)} ${options.border(frame.v)}`,
  );
  const bottom = `${frame.bl}${frame.h.repeat(options.width - 2)}${frame.br}`;
  return [options.border(top), ...rows, options.border(bottom)];
}
