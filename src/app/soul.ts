import { brand, promptWord } from '../brand/brand.js';
import type { Palette } from '../ui/ansi.js';
import { wrapWords } from '../ui/display-width.js';

export interface SoulOptions {
  /** Width of the terminal; the drawing and the text are laid out to fit it. */
  columns: number;
  /** False draws with + - | > so a log file or a plain terminal still reads as a picture. */
  unicode: boolean;
  paint: Palette;
}

interface Glyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  arrow: string;
  down: string;
  branch: string;
  bullet: string;
}

const UNICODE: Glyphs = {
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  h: '─',
  v: '│',
  arrow: '──▶',
  down: '▼',
  branch: '└─',
  bullet: '•',
};

const ASCII: Glyphs = {
  tl: '+',
  tr: '+',
  bl: '+',
  br: '+',
  h: '-',
  v: '|',
  arrow: '-->',
  down: 'v',
  branch: '`-',
  bullet: '*',
};

const BOX_WIDTH = 12;
const GAP = 5;
const FLOW_WIDTH = 4 * (BOX_WIDTH + 2) + 3 * GAP;
const MIN_TEXT = 20;

/** The four stops of a report's journey; each is a box with two short lines of text. */
const STOPS: ReadonlyArray<readonly [string, string]> = [
  ['your chat', 'app'],
  ['Langfuse', 'thumbs'],
  [brand.name, 'this tool'],
  ['Excel', 'report'],
];

function centre(text: string, width: number): string {
  const left = Math.floor((width - text.length) / 2);
  return `${' '.repeat(left)}${text}`.padEnd(width);
}

function stopBox(stop: readonly [string, string], glyphs: Glyphs): string[] {
  return [
    `${glyphs.tl}${glyphs.h.repeat(BOX_WIDTH)}${glyphs.tr}`,
    `${glyphs.v}${centre(stop[0], BOX_WIDTH)}${glyphs.v}`,
    `${glyphs.v}${centre(stop[1], BOX_WIDTH)}${glyphs.v}`,
    `${glyphs.bl}${glyphs.h.repeat(BOX_WIDTH)}${glyphs.br}`,
  ];
}

/** Four boxes in a row joined by arrows, or stacked when the terminal is too narrow for a row. */
function journey({ columns, paint }: SoulOptions, glyphs: Glyphs): string[] {
  const boxes = STOPS.map((stop) => stopBox(stop, glyphs));
  if (columns >= FLOW_WIDTH + 4) {
    const arrow = paint.amber(` ${glyphs.arrow} `.padEnd(GAP).slice(0, GAP));
    const blank = ' '.repeat(GAP);
    return [0, 1, 2, 3].map((row) => {
      const joiner = row === 1 ? arrow : blank;
      return `  ${boxes.map((box) => box[row] ?? '').join(joiner)}`;
    });
  }
  const lines: string[] = [];
  boxes.forEach((box, index) => {
    lines.push(...box.map((line) => `  ${line}`));
    if (index < boxes.length - 1) {
      lines.push(`  ${' '.repeat(Math.floor(BOX_WIDTH / 2))}${paint.amber(glyphs.down)}`);
    }
  });
  return lines;
}

function heading(title: string, { paint }: SoulOptions): string[] {
  return ['', paint.gold(title)];
}

/** Prose wrapped to the terminal, each line indented and painted. */
function prose(text: string, { columns, paint }: SoulOptions, indent = 0): string[] {
  const pad = ' '.repeat(indent);
  return wrapWords(text, Math.max(MIN_TEXT, columns - indent - 1)).map(
    (line) => `${pad}${paint.cream(line)}`,
  );
}

interface LabelledRow {
  label: string;
  labelWidth: number;
  text: string;
  options: SoulOptions;
  indent?: number;
}

/** A label and an explanation; a long explanation wraps under itself, not under the label. */
function labelled({ label, labelWidth, text, options, indent = 2 }: LabelledRow): string[] {
  const { columns, paint } = options;
  const room = Math.max(MIN_TEXT, columns - indent - labelWidth - 1);
  const [first = '', ...rest] = wrapWords(text, room);
  const lead = ' '.repeat(indent);
  return [
    `${lead}${paint.cyan(label.padEnd(labelWidth))}${paint.cream(first)}`,
    ...rest.map((line) => `${lead}${' '.repeat(labelWidth)}${paint.cream(line)}`),
  ];
}

function aboutSection(options: SoulOptions, glyphs: Glyphs): string[] {
  const { columns, paint } = options;
  const title = `${brand.name}: your users' thumbs up and thumbs down, as a report you can read`;
  return [
    ...wrapWords(title, Math.max(MIN_TEXT, columns - 1)).map((line) => paint.gold(line)),
    '',
    ...prose(
      `${brand.name} reads the ratings people give your chat answers, shows them on screen, and writes them to Excel. You do not need to write code or know how Langfuse works inside. If you can type a short command, you can get the report.`,
      options,
    ),
    '',
    ...journey(options, glyphs),
  ];
}

function rowSection(options: SoulOptions, glyphs: Glyphs): string[] {
  const { columns, paint } = options;
  const items = [
    'the question and the answer that was rated',
    'the reasons they ticked, and their comment',
    'the whole conversation, with the rated answer marked',
    'a link that opens that answer in Langfuse',
  ];
  return [
    ...heading('One thumb is one row', options),
    ...prose(`When someone rates an answer, ${brand.name} makes one row with:`, options, 2),
    ...items.flatMap((item) =>
      wrapWords(item, Math.max(MIN_TEXT, columns - 7)).map(
        (line, index) =>
          `    ${index === 0 ? paint.amber(glyphs.bullet) : ' '} ${paint.cream(line)}`,
      ),
    ),
  ];
}

const CHAIN: ReadonlyArray<readonly [name: string, meaning: string]> = [
  ['profile', 'a name you pick, like dev or prod; it holds the address'],
  ['env file', "the file with that profile's secret keys"],
  ['project', 'the Langfuse project those keys open'],
  ['env label', 'a tag on each rating; filter with: env = uat-like'],
];

/** The chain drawn as a staircase: each step sits one level in from the one it depends on. */
function chainSection(options: SoulOptions, glyphs: Glyphs): string[] {
  const { paint } = options;
  const lines = CHAIN.flatMap(([name, meaning], depth) => {
    const indent = 2 + depth * 3;
    const marker = depth === 0 ? '' : glyphs.branch;
    const lead = `${' '.repeat(indent)}${paint.amber(marker.padEnd(3))}`;
    const text = labelled({
      label: name,
      labelWidth: 11,
      text: meaning,
      options,
      indent: indent + 3,
    });
    const [first = '', ...rest] = text;
    return [`${lead}${first.slice(indent + 3)}`, ...rest];
  });
  return [
    ...heading('Where the numbers come from', options),
    ...prose('Each step needs the one before it:', options, 2),
    ...lines,
  ];
}

const COMMANDS: ReadonlyArray<readonly [name: string, meaning: string]> = [
  ['doctor', 'check that everything is set up, and get the fix'],
  ['window 7d', 'choose the dates (today, yesterday, last-week ...)'],
  ['where <filter>', 'narrow the ratings: where rating = negative'],
  ['report', 'read them full screen, like less (q to leave)'],
  ['export', 'write the Excel files (negative and positive)'],
  ['analyse', 'ask a model for the common problems'],
  ['compare', 'did the problems go away? two reports in one file'],
  ['docs', 'ask a question about the tool, in plain words'],
];

function commandSection(options: SoulOptions): string[] {
  return [
    ...heading('What you can do', options),
    ...COMMANDS.flatMap(([name, meaning]) =>
      labelled({ label: name, labelWidth: 16, text: meaning, options }),
    ),
  ];
}

function placesSection(options: SoulOptions): string[] {
  return [
    ...heading('Two places to type', options),
    ...labelled({
      label: 'in a shell',
      labelWidth: 16,
      text: `start every line with ${brand.command}, for example: ${brand.command} doctor. One command, then it ends.`,
      options,
    }),
    ...labelled({
      label: 'in the session',
      labelWidth: 16,
      text: `type ${brand.command} alone. The prompt is ${promptWord(brand)}[dev]> and you leave out the ${brand.command} part: doctor, window 7d, report.`,
      options,
    }),
  ];
}

const FIRST_REPORT: ReadonlyArray<readonly [command: string, meaning: string]> = [
  [`${brand.command} doctor`, 'every problem comes with its fix'],
  [brand.command, 'open the session'],
  ['window 7d', 'load the last 7 days'],
  ['report', 'read the ratings'],
  ['export', 'write the Excel files'],
];

function startSection(options: SoulOptions): string[] {
  const { columns, paint } = options;
  return [
    ...heading('Your first report', options),
    ...FIRST_REPORT.flatMap(([command, meaning], index) =>
      labelled({ label: `${index + 1}. ${command}`, labelWidth: 22, text: meaning, options }),
    ),
    '',
    ...wrapWords(
      'Stuck? Type ? after any command, or: docs <your question>',
      Math.max(MIN_TEXT, columns - 3),
    ).map((line) => `  ${paint.dim(line)}`),
  ];
}

/** The picture-and-words tour of what Jeves does, as lines ready to print. */
export function soulLines(options: SoulOptions): string[] {
  const glyphs = options.unicode ? UNICODE : ASCII;
  return [
    ...aboutSection(options, glyphs),
    ...rowSection(options, glyphs),
    ...chainSection(options, glyphs),
    ...commandSection(options),
    ...placesSection(options),
    ...startSection(options),
  ];
}
