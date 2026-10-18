import { brand, promptWord } from '../brand/brand.js';
import { runDocs, type DocsExchange } from '../app/run-docs.js';
import type { AppContext } from '../app/app-context.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import { DOCS_MODE_HELP } from '../help/command-help.js';
import { createPalette } from '../ui/ansi.js';
import { renderBox } from '../ui/box.js';
import { readLine } from './line-editor.js';
import type { LineHints } from './suggest-line.js';

const BOX_WIDTH = 76;
export const DOCS_PROMPT = '🤖 docs> ';

/** Words that are never questions, so they cannot be sent to the model by mistake. */
const LEAVE_MODE = new Set(['done']);
const LEAVE_PROGRAM = new Set(['exit', 'quit']);
const ASK_FOR_HELP = new Set(['?', 'help', '--help']);

export interface DocsChatRequest {
  app: AppContext;
  resolved: ResolvedConfig;
  history: DocsExchange[];
}

function hintsFor(text: string): LineHints {
  const hint =
    text.trim() === ''
      ? `type a question, or "done" to go back to ${promptWord(brand)}>`
      : 'press Enter to ask';
  return { replaceFrom: text.length, suggestions: [{ insert: '', hint }] };
}

/** The yellow box shown on entry: what this mode is and how to leave it. */
export function docsHeader(app: AppContext): string[] {
  const palette = createPalette(app.color);
  return renderBox(
    'Docs agent',
    [
      `Ask anything about ${brand.name} or how Langfuse must be set up for it.`,
      'Every line you type is a question. Follow-ups remember earlier answers.',
      `done: back to ${promptWord(brand)}>`,
      'exit or quit: leave the program',
      '?: help for this mode',
    ],
    {
      width: Math.min(BOX_WIDTH, Math.max(40, app.columns - 2)),
      border: palette.gold,
      unicode: app.color,
    },
  );
}

/** The reminder printed under every answer. */
export function docsFooter(app: AppContext): string {
  return createPalette(app.color).dim('  done = back · exit = leave the program · ? = help');
}

/**
 * Chat with the docs agent until the user leaves. Returns false when the whole program should end
 * (`exit`, `quit`), true to go back to the main prompt (`done`, Ctrl+C).
 */
export async function runDocsChat({ app, resolved, history }: DocsChatRequest): Promise<boolean> {
  for (const line of docsHeader(app)) app.reporter.styled(line);
  const typed: string[] = [];
  for (;;) {
    const line = await readLine({
      prompt: DOCS_PROMPT,
      promptColor: 'violet',
      history: typed,
      color: app.color,
      hints: hintsFor,
    });
    if (line === undefined) return true;
    const word = line.trim().toLowerCase();
    if (word === '') continue;
    if (LEAVE_MODE.has(word)) return true;
    if (LEAVE_PROGRAM.has(word)) return false;
    if (ASK_FOR_HELP.has(word)) {
      for (const text of DOCS_MODE_HELP) app.reporter.note(text);
      continue;
    }
    try {
      await runDocs({ resolved, reporter: app.reporter, question: line.trim(), history });
    } catch (err) {
      app.reporter.cancel();
      app.reporter.warn(err instanceof Error ? err.message : String(err));
    }
    app.reporter.styled(docsFooter(app));
  }
}
