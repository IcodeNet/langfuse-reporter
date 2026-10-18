import { padVisible, visibleWidth, type Palette } from '../ui/ansi.js';
import { truncateToWidth } from '../ui/display-width.js';
import type { PagerLine, PagerScreen, PagerState } from './pager-model.js';

const ESC = String.fromCharCode(27);
export const ENTER_SCREEN = `${ESC}[?1049h${ESC}[?25l`;
export const LEAVE_SCREEN = `${ESC}[?25h${ESC}[?1049l`;
const HOME_AND_CLEAR = `${ESC}[H${ESC}[2J`;
const REVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;

const HELP_LINES: readonly string[] = [
  ' Moving       j / ↓ / Enter  line down      k / ↑   line up',
  '              Space / f      page down      b       page up',
  '              d / u          half a page    g / G   top / bottom',
  ' Ratings      ]  next rating                [       previous rating',
  ' Searching    /text  search (lower case ignores case)',
  '              n  next match                 N       previous match',
  ' Leaving      q   or   Esc   or   :q + Enter',
  ' Any key closes this help.',
];

function paint(line: PagerLine, palette: Palette): string {
  const styles: Record<PagerLine['kind'], (text: string) => string> = {
    title: palette.gold,
    heading: line.tone === 'positive' ? palette.green : palette.red,
    label: palette.dim,
    body: (text) => text,
    rule: palette.dim,
  };
  return styles[line.kind](line.text);
}

/** Marks every match of the search on a line, in reverse video. */
function highlight(text: string, search: string): string {
  if (search === '') return text;
  const exact = /[A-Z]/.test(search);
  const hay = exact ? text : text.toLowerCase();
  const needle = exact ? search : search.toLowerCase();
  let out = '';
  let from = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, from)) {
    out += `${text.slice(from, at)}${REVERSE}${text.slice(at, at + needle.length)}${RESET}`;
    from = at + needle.length;
  }
  return out + text.slice(from);
}

function statusText(state: PagerState, screen: PagerScreen): string {
  if (state.mode === 'search') return `/${state.input}`;
  if (state.mode === 'command') return `:${state.input}`;
  if (state.message !== '') return state.message;
  const total = screen.lines.length;
  const last = Math.min(total, state.top + screen.height);
  const percent = total === 0 ? 100 : Math.round((last / total) * 100);
  const hits = state.hits.length > 0 ? `   match ${state.hitPos + 1}/${state.hits.length}` : '';
  return `lines ${total === 0 ? 0 : state.top + 1}-${last} of ${total}  ${percent}%${hits}   h help   q quit`;
}

export interface FrameRequest {
  state: PagerState;
  screen: PagerScreen;
  columns: number;
  palette: Palette;
}

/** One whole screen: the visible lines, then a reverse-video status line. */
export function renderFrame({ state, screen, columns, palette }: FrameRequest): string {
  if (state.mode === 'help') {
    const body = HELP_LINES.map((line) => truncateToWidth(line, columns));
    return `${HOME_AND_CLEAR}${body.join('\r\n')}`;
  }
  const visible = screen.lines.slice(state.top, state.top + screen.height);
  const rows = visible.map((line) => {
    const cut = truncateToWidth(line.text, columns);
    const marked = highlight(cut, state.search);
    return marked === cut ? paint({ ...line, text: cut }, palette) : marked;
  });
  while (rows.length < screen.height) rows.push(palette.dim('~'));
  const status = padVisible(truncateToWidth(statusText(state, screen), columns), columns);
  const bar = visibleWidth(status) > columns ? status : `${REVERSE}${status}${RESET}`;
  return `${HOME_AND_CLEAR}${rows.join('\r\n')}\r\n${bar}`;
}
