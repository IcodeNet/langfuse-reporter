const ESC = String.fromCharCode(27);

/** CSI sequences (colours, cursor moves, clears) and OSC sequences (titles, links), ended by BEL or ESC. */
const ESCAPE_SEQUENCES = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${String.fromCharCode(7)}${ESC}]*(?:${String.fromCharCode(7)}|${ESC}\\\\)?|${ESC}[@-Z\\\\-_]`,
  'g',
);

const TAB = 9;
const NEWLINE = 10;

/** C0 (0 to 31), DEL and C1 (127 to 159) control characters, except tab and newline which layout handles itself. */
function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  const isC0 = code < 32;
  const isDeleteOrC1 = code >= 127 && code <= 159;
  const isLayout = code === TAB || code === NEWLINE;
  return (isC0 || isDeleteOrC1) && !isLayout;
}

/**
 * Makes text from a customer, a model or a provider safe to print: escape sequences and control
 * characters are removed, so stored text cannot clear the screen, move the cursor, retitle the
 * window or forge lines of output. Printable text, tabs and newlines are kept.
 */
export function stripControlCharacters(text: string): string {
  return Array.from(text.replace(ESCAPE_SEQUENCES, ''))
    .filter((character) => !isControlCharacter(character))
    .join('');
}

/** Like `stripControlCharacters`, but tabs and line breaks become single spaces so the text stays on one row. */
export function toOneLine(text: string): string {
  return stripControlCharacters(text).replace(/[\t\n]+/g, ' ');
}

/** True when the text is printable and on one line: no control characters, tabs or line breaks. */
export function isPlainOneLine(text: string): boolean {
  return stripControlCharacters(text) === text && !/[\t\n]/.test(text);
}
