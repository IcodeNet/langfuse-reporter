import { emitKeypressEvents } from 'node:readline';
import { CURSOR, createPalette, stripAnsi, type Palette } from '../ui/ansi.js';
import { displayWidth } from '../ui/display-width.js';
import { stripControlCharacters as safe } from '../ui/untrusted-text.js';
import { suggestionRows } from './suggestion-rows.js';
import {
  applicable,
  applySuggestion,
  arrowTarget,
  moveSelection,
  type Direction,
} from './editor-logic.js';
import type { LineHints } from './suggest-line.js';

export interface LineEditorOptions {
  prompt: string;
  /** Which palette colour paints the prompt; the docs mode uses violet so it is easy to tell apart. */
  promptColor?: 'amber' | 'violet' | 'red';
  hints: (line: string) => LineHints;
  history: string[];
  color: boolean;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

/** A thin line the width of the terminal; plain dashes when colour is off, so a log still shows the break. */
export function messageRule(color: boolean, columns = process.stdout.columns || 80): string {
  const width = Math.max(10, Math.min(columns, 200));
  return createPalette(color).dim((color ? '─' : '-').repeat(width));
}

/** Draws the prompt line and the suggestion rows under it, remembering how many rows it used. */
class EditorView {
  private rowsBelow = 0;

  constructor(
    private readonly prompt: string,
    private readonly paint: Palette,
    private readonly promptColor: 'amber' | 'violet' | 'red',
  ) {}

  render(buffer: string, hints: LineHints, selected: number | undefined): void {
    const rows = suggestionRows({ hints, selected, paint: this.paint });
    let out = `${CURSOR.clearLine}${this.paint[this.promptColor](this.prompt)}${this.paint.typed(safe(buffer))}`;
    const rowsDrawn = Math.max(this.rowsBelow, rows.length);
    for (let index = 0; index < rowsDrawn; index++) {
      out += `\n${CURSOR.clearLine}${rows[index] ?? ''}`;
    }
    if (rowsDrawn > 0) out += CURSOR.up.repeat(rowsDrawn);
    const column = stripAnsi(this.prompt).length + displayWidth(safe(buffer));
    out += `\r${column > 0 ? `\u001b[${column}C` : ''}`;
    process.stdout.write(out);
    this.rowsBelow = rows.length;
  }

  clearBelow(): void {
    let out = '';
    for (let index = 0; index < this.rowsBelow; index++) out += `\n${CURSOR.clearLine}`;
    if (this.rowsBelow > 0) out += CURSOR.up.repeat(this.rowsBelow);
    process.stdout.write(out);
    this.rowsBelow = 0;
  }
}

/** One prompt's state and key handling; settles `done` when the user submits or quits. */
class LineSession {
  private buffer = '';
  private selected: number | undefined;
  private historyIndex: number;
  /** True from the first history line shown until the user types, so Up and Down keep walking the history. */
  private browsingHistory = false;
  private readonly view: EditorView;
  private readonly onKey = (text: string | undefined, key: Key | undefined): void =>
    this.handleKey(text, key);

  private readonly ctrlHandlers: Record<string, () => void> = {
    c: () => this.finish(undefined),
    d: () => {
      if (this.buffer === '') this.finish(undefined);
    },
    p: () => this.browseHistory(-1),
    n: () => this.browseHistory(1),
    u: () => this.edit(''),
  };

  private readonly keyHandlers: Record<string, () => void> = {
    return: () => {
      if (this.selected === undefined) this.finish(this.buffer);
      else this.accept(false);
    },
    tab: () => this.accept(true),
    down: () => this.onArrow(1),
    up: () => this.onArrow(-1),
    escape: () => this.edit(''),
    backspace: () => this.edit(this.buffer.slice(0, -1)),
  };

  constructor(
    private readonly options: LineEditorOptions,
    private readonly done: (value: string | undefined) => void,
  ) {
    this.view = new EditorView(
      options.prompt,
      createPalette(options.color),
      options.promptColor ?? 'amber',
    );
    this.historyIndex = options.history.length;
  }

  start(): void {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', this.onKey);
    this.render();
  }

  private render(): void {
    this.view.render(this.buffer, this.options.hints(this.buffer), this.selected);
  }

  private finish(value: string | undefined): void {
    this.view.clearBelow();
    process.stdout.write(`\n${messageRule(this.options.color)}\n`);
    process.stdin.setRawMode(false);
    process.stdin.off('keypress', this.onKey);
    process.stdin.pause();
    if (value) this.options.history.push(value);
    this.done(value);
  }

  private edit(next: string): void {
    this.buffer = next;
    this.selected = undefined;
    this.browsingHistory = false;
    this.render();
  }

  /** Accepts the highlighted suggestion, or the first one when Tab is pressed with none highlighted. */
  private accept(fallbackToFirst: boolean): void {
    const hints = this.options.hints(this.buffer);
    const choices = applicable(hints.suggestions);
    const index = this.selected ?? (fallbackToFirst && choices.length > 0 ? 0 : undefined);
    const chosen = index === undefined ? undefined : choices[index];
    if (chosen) this.edit(applySuggestion(this.buffer, hints.replaceFrom, chosen.insert));
  }

  private onArrow(direction: Direction): void {
    const choices = applicable(this.options.hints(this.buffer).suggestions);
    const target = arrowTarget({
      browsingHistory: this.browsingHistory,
      bufferIsEmpty: this.buffer === '',
      hasSelection: this.selected !== undefined,
      hasChoices: choices.length > 0,
      direction,
    });
    if (target === 'history') {
      this.browseHistory(direction);
      return;
    }
    this.selected = moveSelection(this.selected, choices.length, direction);
    this.render();
  }

  private browseHistory(direction: Direction): void {
    const { history } = this.options;
    const next = this.historyIndex + direction;
    if (next < 0 || next > history.length) return;
    this.historyIndex = next;
    this.edit(history[next] ?? '');
    this.browsingHistory = true;
  }

  private handleKey(text: string | undefined, key: Key | undefined): void {
    const name = key?.name ?? '';
    const handler = key?.ctrl ? this.ctrlHandlers[name] : this.keyHandlers[name];
    if (handler) return handler();
    const isPrintable = text !== undefined && !key?.ctrl && !key?.meta && text >= ' ';
    if (isPrintable) this.edit(this.buffer + text);
  }
}

/**
 * Reads one line with live suggestions drawn under the prompt on every keystroke.
 * Up/Down move a highlight through the suggestions; Tab or Enter accepts the highlighted one
 * (Tab alone takes the first when nothing is highlighted). Ctrl-P/Ctrl-N browse history, and the
 * arrows do too when there is nothing to select. Esc clears the line. Ctrl-C always, and Ctrl-D on an
 * empty line, return undefined, which ends the session.
 */
export function readLine(options: LineEditorOptions): Promise<string | undefined> {
  return new Promise((resolve) => new LineSession(options, resolve).start());
}
