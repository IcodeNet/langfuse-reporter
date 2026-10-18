/** One line of the report, with enough meaning for the view to colour it. */
export interface PagerLine {
  text: string;
  kind: 'title' | 'heading' | 'label' | 'body' | 'rule';
  /** Colours a rating heading green or red. */
  tone?: 'positive' | 'negative';
}

/** The slice of a readline keypress the pager needs. */
export interface PagerKey {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}

export interface PagerState {
  top: number;
  mode: 'view' | 'search' | 'command' | 'help';
  /** What is being typed after / or :. */
  input: string;
  /** The last search, kept for n and N. */
  search: string;
  hits: readonly number[];
  hitPos: number;
  /** One-off note for the status line, cleared by the next key. */
  message: string;
}

export interface PagerScreen {
  lines: readonly PagerLine[];
  /** Rows available for text, not counting the status line. */
  height: number;
}

export interface Step {
  state: PagerState;
  quit: boolean;
}

export function initialState(): PagerState {
  return { top: 0, mode: 'view', input: '', search: '', hits: [], hitPos: -1, message: '' };
}

const NAMED_KEYS: ReadonlySet<string> = new Set([
  'up',
  'down',
  'pageup',
  'pagedown',
  'home',
  'end',
  'escape',
  'return',
  'enter',
  'backspace',
  'space',
]);

/** Special keys by name; everything else by the character typed, so G and g differ. */
function tokenOf(key: PagerKey): string {
  if (key.name && NAMED_KEYS.has(key.name)) return key.name;
  return key.sequence ?? '';
}

function maxTop({ lines, height }: PagerScreen): number {
  return Math.max(0, lines.length - height);
}

function clampTop(top: number, screen: PagerScreen): number {
  return Math.min(Math.max(0, top), maxTop(screen));
}

function scrolled(state: PagerState, by: number, screen: PagerScreen): PagerState {
  return { ...state, top: clampTop(state.top + by, screen) };
}

/** Smart case, as in less: a query with a capital letter matches case exactly. */
export function findHits(lines: readonly PagerLine[], query: string): number[] {
  if (query === '') return [];
  const exact = /[A-Z]/.test(query);
  const needle = exact ? query : query.toLowerCase();
  return lines.flatMap((line, index) => {
    const hay = exact ? line.text : line.text.toLowerCase();
    return hay.includes(needle) ? [index] : [];
  });
}

function jumpTo(state: PagerState, hitPos: number, screen: PagerScreen): PagerState {
  const line = state.hits[hitPos] ?? 0;
  return { ...state, hitPos, top: clampTop(line, screen) };
}

function startSearch(state: PagerState, query: string, screen: PagerScreen): PagerState {
  const base: PagerState = { ...state, mode: 'view', input: '', search: query };
  if (query === '') return { ...base, hits: [], hitPos: -1 };
  const hits = findHits(screen.lines, query);
  if (hits.length === 0) {
    return { ...base, hits, hitPos: -1, message: `Pattern not found: ${query}` };
  }
  const fromTop = hits.findIndex((line) => line >= state.top);
  return jumpTo({ ...base, hits }, fromTop === -1 ? 0 : fromTop, screen);
}

function stepHit(state: PagerState, direction: 1 | -1, screen: PagerScreen): PagerState {
  if (state.hits.length === 0) {
    return {
      ...state,
      message: state.search === '' ? 'No search yet: type /text' : 'Pattern not found',
    };
  }
  const count = state.hits.length;
  const next = (state.hitPos + direction + count) % count;
  return jumpTo(state, next, screen);
}

const QUIT_COMMANDS: ReadonlySet<string> = new Set(['q', 'q!', 'quit', 'qa', 'x']);

function runCommand(state: PagerState): Step {
  const typed = state.input.trim();
  const cleared: PagerState = { ...state, mode: 'view', input: '' };
  if (QUIT_COMMANDS.has(typed)) return { state: cleared, quit: true };
  const note = typed === '' ? '' : `Not a command: :${typed}   (:q leaves)`;
  return { state: { ...cleared, message: note }, quit: false };
}

function isPrintable(key: PagerKey): boolean {
  const text = key.sequence ?? '';
  return text.length === 1 && text >= ' ' && text !== '\u007f' && !key.ctrl && !key.meta;
}

/** Typing after / or :. Esc cancels the typing, it does not leave the report. */
function typing(state: PagerState, key: PagerKey, screen: PagerScreen): Step {
  const token = tokenOf(key);
  const cancelled: PagerState = { ...state, mode: 'view', input: '' };
  if (token === 'escape') return { state: cancelled, quit: false };
  if (key.ctrl && key.name === 'c') return { state: cancelled, quit: false };
  if (token === 'backspace') {
    const emptied = state.input === '';
    return {
      state: emptied ? cancelled : { ...state, input: state.input.slice(0, -1) },
      quit: false,
    };
  }
  if (token === 'return' || token === 'enter') {
    if (state.mode === 'command') return runCommand(state);
    return { state: startSearch(state, state.input, screen), quit: false };
  }
  if (isPrintable(key))
    return { state: { ...state, input: state.input + key.sequence }, quit: false };
  return { state, quit: false };
}

const BY_LINE_DOWN: ReadonlySet<string> = new Set(['j', 'down', 'return', 'enter']);
const BY_LINE_UP: ReadonlySet<string> = new Set(['k', 'up']);
const PAGE_DOWN: ReadonlySet<string> = new Set(['space', 'f', 'pagedown']);
const PAGE_UP: ReadonlySet<string> = new Set(['b', 'pageup']);

/** Moves by a line, a page or to an end; undefined when the key is not a movement. */
function movement(state: PagerState, key: PagerKey, screen: PagerScreen): PagerState | undefined {
  const token = tokenOf(key);
  const page = Math.max(1, screen.height - 1);
  const half = Math.max(1, Math.floor(screen.height / 2));
  if (key.ctrl) {
    const byControl: Record<string, number> = { d: half, u: -half, f: page, b: -page, n: 1, p: -1 };
    const by = byControl[key.name ?? ''];
    return by === undefined ? undefined : scrolled(state, by, screen);
  }
  if (BY_LINE_DOWN.has(token)) return scrolled(state, 1, screen);
  if (BY_LINE_UP.has(token)) return scrolled(state, -1, screen);
  if (PAGE_DOWN.has(token)) return scrolled(state, page, screen);
  if (PAGE_UP.has(token)) return scrolled(state, -page, screen);
  if (token === 'd') return scrolled(state, half, screen);
  if (token === 'u') return scrolled(state, -half, screen);
  if (token === 'g' || token === 'home' || token === '<') return { ...state, top: 0 };
  if (token === 'G' || token === 'end' || token === '>') return { ...state, top: maxTop(screen) };
  return undefined;
}

/** Jumps to the next or previous rating heading. */
function byRating(state: PagerState, direction: 1 | -1, screen: PagerScreen): PagerState {
  const headings = screen.lines.flatMap((line, index) => (line.kind === 'heading' ? [index] : []));
  const target =
    direction === 1
      ? headings.find((line) => line > state.top)
      : [...headings].reverse().find((line) => line < state.top);
  return target === undefined ? state : { ...state, top: clampTop(target, screen) };
}

/** One key pressed while looking at the report. */
export function handleKey(state: PagerState, key: PagerKey, screen: PagerScreen): Step {
  if (key.ctrl && key.name === 'c') return { state, quit: true };
  if (state.mode === 'search' || state.mode === 'command') return typing(state, key, screen);
  const fresh: PagerState = { ...state, message: '' };
  if (state.mode === 'help') return { state: { ...fresh, mode: 'view' }, quit: false };

  const token = tokenOf(key);
  if (token === 'q' || token === 'Q' || token === 'escape') return { state: fresh, quit: true };
  const moved = movement(fresh, key, screen);
  if (moved) return { state: moved, quit: false };

  const actions: Record<string, () => PagerState> = {
    '/': () => ({ ...fresh, mode: 'search', input: '' }),
    ':': () => ({ ...fresh, mode: 'command', input: '' }),
    n: () => stepHit(fresh, 1, screen),
    N: () => stepHit(fresh, -1, screen),
    ']': () => byRating(fresh, 1, screen),
    '[': () => byRating(fresh, -1, screen),
    h: () => ({ ...fresh, mode: 'help' }),
    H: () => ({ ...fresh, mode: 'help' }),
  };
  const action = actions[token];
  return { state: action ? action() : fresh, quit: false };
}

/** Keeps the top line valid after the terminal is resized or the lines are rebuilt. */
export function clampState(state: PagerState, screen: PagerScreen): PagerState {
  return { ...state, top: clampTop(state.top, screen) };
}
