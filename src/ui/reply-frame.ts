import type { Palette } from './ansi.js';
import { displayWidth } from './display-width.js';

export interface ReplyFrameOptions {
  /** Terminal width; the top and bottom lines span it. */
  columns: number;
  /** Colours the frame lines; identity when colour is off. */
  border: Palette['gold'];
  /** False draws with + - instead of rounded corners, for a console that cannot show them. */
  unicode: boolean;
}

const UNICODE = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─' } as const;
const ASCII = { tl: '+', tr: '+', bl: '+', br: '+', h: '-' } as const;

/** Narrowest frame worth drawing; below this the title would not fit. */
const MIN_WIDTH = 24;

/**
 * Puts a reply between a titled top line and a closing bottom line. The
 * sides stay open, so the text can be selected and copied without frame characters in it.
 */
export function frameReply(title: string, body: string, options: ReplyFrameOptions): string {
  const glyphs = options.unicode ? UNICODE : ASCII;
  const width = Math.max(MIN_WIDTH, options.columns - 1);
  const heading = ` ${title} `;
  const fill = Math.max(2, width - 3 - displayWidth(heading));
  const top = `${glyphs.tl}${glyphs.h}${heading}${glyphs.h.repeat(fill)}${glyphs.tr}`;
  const bottom = `${glyphs.bl}${glyphs.h.repeat(width - 2)}${glyphs.br}`;
  return [options.border(top), body.replace(/\n+$/, ''), options.border(bottom)].join('\n');
}
