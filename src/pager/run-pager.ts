import { emitKeypressEvents } from 'node:readline';
import { createPalette } from '../ui/ansi.js';
import {
  clampState,
  handleKey,
  initialState,
  type PagerKey,
  type PagerLine,
  type PagerScreen,
} from './pager-model.js';
import { ENTER_SCREEN, LEAVE_SCREEN, renderFrame } from './pager-view.js';

export interface PagerRequest {
  /** Builds the lines for a terminal width, so a resize re-wraps the text. */
  buildLines: (columns: number) => PagerLine[];
  color: boolean;
}

/** True when keys can be read and a screen drawn; a pipe or CI gets the plain text instead. */
export function canPage(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

/**
 * Shows the lines full screen, like less: the alternate screen keeps the user's scrollback, and the
 * terminal is always put back, however the pager ends.
 */
export function runPager({ buildLines, color }: PagerRequest): Promise<void> {
  const palette = createPalette(color);
  let columns = process.stdout.columns || 80;
  let rows = process.stdout.rows || 24;
  let lines = buildLines(columns);
  let state = initialState();
  const screen = (): PagerScreen => ({ lines, height: Math.max(1, rows - 1) });

  const draw = (): void => {
    process.stdout.write(renderFrame({ state, screen: screen(), columns, palette }));
  };

  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKey);
      process.stdout.off('resize', onResize);
      process.off('exit', restore);
      restore();
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve();
    };

    function restore(): void {
      process.stdout.write(LEAVE_SCREEN);
    }

    function onResize(): void {
      columns = process.stdout.columns || 80;
      rows = process.stdout.rows || 24;
      lines = buildLines(columns);
      state = clampState(state, screen());
      draw();
    }

    function onKey(_text: string | undefined, key: PagerKey | undefined): void {
      const step = handleKey(state, key ?? {}, screen());
      state = step.state;
      if (step.quit) finish();
      else draw();
    }

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);
    process.stdout.on('resize', onResize);
    process.on('exit', restore);
    process.stdout.write(ENTER_SCREEN);
    draw();
  });
}
