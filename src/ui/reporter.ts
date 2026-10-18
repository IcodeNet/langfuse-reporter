import { CURSOR, createPalette, type Palette } from './ansi.js';
import { pickFormatter } from '../render/pick-formatter.js';
import { frameReply } from './reply-frame.js';
import { stripControlCharacters as safe, toOneLine } from './untrusted-text.js';

const DEFAULT_DOCUMENT_COLUMNS = 80;

/** What a step is doing; picks its emoji on a terminal. Plain output ignores it. */
type TaskKind =
  | 'connect'
  | 'fetch'
  | 'conversations'
  | 'match'
  | 'filter'
  | 'write'
  | 'save'
  | 'switch'
  | 'docs'
  | 'step';

const TASK_EMOJI: Record<TaskKind, string> = {
  connect: '🔑',
  fetch: '📥',
  conversations: '💬',
  match: '🔗',
  filter: '🔎',
  write: '📊',
  save: '⚙️ ',
  switch: '🔀',
  docs: '🧠',
  step: '▶️ ',
};

interface Task {
  /** Replaces the spinner text, e.g. with a running count. */
  update: (text: string) => void;
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
}

/** Label and value pairs shown as a titled block, e.g. the search criteria. */
export interface Block {
  title: string;
  /** Heading emoji on a terminal; plain output ignores it. */
  emoji?: string;
  rows: ReadonlyArray<readonly [label: string, value: string]>;
}

/** Everything the CLI does is reported through this, so no action happens silently. */
export interface Reporter {
  task: (label: string, kind?: TaskKind) => Task;
  done: (text: string) => void;
  info: (text: string) => void;
  /** A line of plain text with no symbol. */
  note: (text: string) => void;
  /** Lines the CLI styled itself (a box, a footer). Escape codes are kept, so never pass customer or model text. */
  styled: (text: string) => void;
  /** Markdown from the docs or a model, drawn as styled text on a terminal and left as it is in a pipe. */
  document: (markdown: string, title?: string) => void;
  warn: (text: string) => void;
  /** A titled block of label/value rows, coloured on a terminal and aligned plain text otherwise. */
  block: (block: Block) => void;
  /** Runs `run` between a titled top line and a closing line on a terminal; in a pipe it just runs. */
  section: <T>(title: string, run: () => Promise<T> | T) => Promise<T>;
  /** Stops a spinner an error left running, so it cannot keep redrawing over the next prompt. */
  cancel: () => void;
}

export interface ReporterOptions {
  stream: Pick<NodeJS.WriteStream, 'write'>;
  /** True on a terminal: animated spinner, colour and emoji. False: one plain line per event. */
  interactive: boolean;
  /** Width the text is wrapped to; defaults to 80. */
  columns?: number;
  /** Colour on or off; defaults to `interactive`, so `NO_COLOR` can turn colour off on a terminal. */
  color?: boolean;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

interface ActiveTask {
  text: string;
  emoji: string;
  frame: number;
  timer?: NodeJS.Timeout;
}

function plainBlockLines({ title, rows }: Block): string[] {
  const width = Math.max(0, ...rows.map(([label]) => toOneLine(label).length));
  return [
    toOneLine(title),
    ...rows.map(([label, value]) => `  ${toOneLine(label).padEnd(width)}  ${toOneLine(value)}`),
  ];
}

function colouredBlockLines({ title, rows, emoji = '🔎' }: Block, paint: Palette): string[] {
  const width = Math.max(0, ...rows.map(([label]) => toOneLine(label).length));
  return [
    paint.gold(`${emoji} ${toOneLine(title)}`),
    ...rows.map(
      ([label, value]) =>
        `  ${paint.cyan(toOneLine(label).padEnd(width))}  ${paint.cream(toOneLine(value))}`,
    ),
  ];
}

export function createReporter({
  stream,
  interactive,
  color = interactive,
  columns = DEFAULT_DOCUMENT_COLUMNS,
}: ReporterOptions): Reporter {
  const paint = createPalette(color);
  let active: ActiveTask | undefined;

  const clear = (): void => {
    if (interactive) stream.write(CURSOR.clearLine);
  };
  const draw = (): void => {
    if (!active) return;
    const frame = FRAMES[active.frame % FRAMES.length] ?? '';
    stream.write(`${CURSOR.clearLine}${paint.amber(frame)} ${active.emoji} ${safe(active.text)}`);
  };
  const print = (line: string): void => {
    clear();
    stream.write(`${line}\n`);
    draw();
  };

  return {
    task(label, kind = 'step') {
      const emoji = TASK_EMOJI[kind];
      const state: ActiveTask = { text: label, emoji, frame: 0 };
      if (interactive) {
        active = state;
        draw();
        state.timer = setInterval(() => {
          state.frame++;
          draw();
        }, FRAME_MS);
        state.timer.unref();
      } else {
        stream.write(`… ${safe(label)}\n`);
      }
      const finish = (symbol: string, message: string): void => {
        if (state.timer) clearInterval(state.timer);
        if (active === state) active = undefined;
        clear();
        stream.write(`${symbol} ${interactive ? `${emoji} ` : ''}${safe(message)}\n`);
      };
      return {
        update(text) {
          state.text = text;
          draw();
        },
        succeed: (message = state.text) => finish(paint.green('✓'), message),
        fail: (message = state.text) => finish(paint.red('✗'), message),
      };
    },
    done: (text) => print(`${paint.green('✓')} ${interactive ? '✅ ' : ''}${safe(text)}`),
    info: (text) => print(`${paint.dim('·')} ${interactive ? '💡 ' : ''}${safe(text)}`),
    note: (text) => print(safe(text)),
    styled: (text) => print(text),
    document: (markdown, title) => {
      const formatter = pickFormatter({ styled: color });
      const text = formatter.format(safe(markdown), { columns, styled: color });
      print(
        title !== undefined && interactive
          ? frameReply(safe(title), text, { columns, border: paint.gold, unicode: true })
          : text,
      );
    },
    warn: (text) => print(`${paint.amber('!')} ${interactive ? '⚠️  ' : ''}${safe(text)}`),
    section: async (title, run) => {
      if (!interactive) return run();
      const [top = '', bottom = ''] = frameReply(safe(title), '\u0000', {
        columns,
        border: paint.gold,
        unicode: true,
      }).split('\n\u0000\n');
      print(top);
      try {
        return await run();
      } finally {
        print(bottom);
      }
    },
    cancel: () => {
      if (!active) return;
      if (active.timer) clearInterval(active.timer);
      active = undefined;
      clear();
    },
    block: (block) => {
      const lines = interactive ? colouredBlockLines(block, paint) : plainBlockLines(block);
      for (const line of lines) print(line);
    },
  };
}
