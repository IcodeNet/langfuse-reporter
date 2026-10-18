import { displayWidth } from './display-width.js';
const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

type Paint = (text: string) => string;

export interface Palette {
  gold: Paint;
  amber: Paint;
  bronze: Paint;
  cream: Paint;
  dim: Paint;
  bold: Paint;
  red: Paint;
  green: Paint;
  cyan: Paint;
  violet: Paint;
  /** The text the user types: bold and light, so it never looks like the CLI's own output. */
  typed: Paint;
}

function fg(hex: string): Paint {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return (text) => `${ESC}[38;2;${red};${green};${blue}m${text}${RESET}`;
}

function boldFg(hex: string): Paint {
  const paint = fg(hex);
  return (text) => `${ESC}[1m${paint(text)}`;
}

const plain: Paint = (text) => text;

/** Banner colours (gold) when colour is on; identity functions when output is not a terminal. */
export function createPalette(color: boolean): Palette {
  if (!color) {
    return {
      gold: plain,
      amber: plain,
      bronze: plain,
      cream: plain,
      dim: plain,
      bold: plain,
      red: plain,
      green: plain,
      cyan: plain,
      violet: plain,
      typed: plain,
    };
  }
  return {
    gold: boldFg('#FFD700'),
    amber: fg('#FFBF00'),
    bronze: fg('#CD7F32'),
    cream: fg('#FFF8DC'),
    dim: fg('#B8860B'),
    bold: (text) => `${ESC}[1m${text}${RESET}`,
    red: fg('#FF6B6B'),
    green: fg('#7FD18B'),
    cyan: fg('#5FD7FF'),
    violet: fg('#C792EA'),
    typed: boldFg('#FFFFFF'),
  };
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function visibleWidth(text: string): number {
  return displayWidth(stripAnsi(text));
}

export function padVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

export const CURSOR = {
  clearLine: `\r${ESC}[2K`,
  save: `${ESC}7`,
  restore: `${ESC}8`,
  down: `${ESC}[1B`,
  up: `${ESC}[1A`,
} as const;
