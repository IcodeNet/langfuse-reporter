import { passthroughFormatter } from './adapters/passthrough-formatter.js';
import { terminalMarkdownFormatter } from './adapters/terminal-markdown-formatter.js';
import type { TextFormatter } from './text-formatter.js';

/** Markdown on a terminal, untouched text everywhere else. New targets are added here. */
export function pickFormatter(output: { styled: boolean }): TextFormatter {
  return output.styled ? terminalMarkdownFormatter : passthroughFormatter;
}
