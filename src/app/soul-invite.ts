import { brand } from '../brand/brand.js';
import type { Palette } from '../ui/ansi.js';
import { renderBox } from '../ui/box.js';

export interface SoulInviteOptions {
  columns: number;
  unicode: boolean;
  paint: Palette;
}

/** Empty lines before the invitation, so it stands apart from the hint above it. */
export const INVITE_GAP_LINES = 3;

const MAX_WIDTH = 64;
const MIN_WIDTH = 32;

const ART_UNICODE = ['      ✦        ·  ˚', '   ·     ✧  ✦      ✧', '      ˚   ✦    ·'];
const ART_ASCII = ['      *        .  .', '   .     *  *      *', '      .   *    .'];

const BODY = [
  'Meet the soul of this tool.',
  'A short tour in plain English, with pictures: what it does, how the pieces fit together, and your first report in five steps.',
  '',
  'Rather click than type?',
  'The setup page opens in your browser and walks you through connecting Langfuse, one question at a time.',
  '',
  'No Langfuse account yet?',
  'Every command also runs on built-in sample data, so you can try it first. Type this in your normal terminal, not here.',
];

/**
 * The welcome card that points a new user at the `soul` command: a gap, a little star field, a
 * box with one friendly paragraph, and the command to type. Plain text lines when colour is off.
 */
export function soulInviteLines({ columns, unicode, paint }: SoulInviteOptions): string[] {
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, columns - 2));
  const art = (unicode ? ART_UNICODE : ART_ASCII).map((line) => paint.amber(line));
  const box = renderBox(unicode ? '✦ New here? ✦' : '* New here? *', BODY, {
    width,
    border: paint.gold,
    unicode,
  });
  const arrow = unicode ? '▶' : '>';
  const tour = `   ${paint.amber(arrow)}  ${paint.typed('soul')}  a picture tour`;
  const setup = `   ${paint.amber(arrow)}  ${paint.typed('ui')}    the setup page`;
  const demo = `   ${paint.amber(arrow)}  ${paint.typed(`${brand.command} --demo doctor`)}`;
  return [...Array<string>(INVITE_GAP_LINES).fill(''), ...art, ...box, '', tour, setup, demo, ''];
}
