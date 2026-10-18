/**
 * Removes `//` and `/* *\/` comments from JSON text so a config file can explain itself. Text
 * inside strings is left alone, and removed comments keep their line breaks so error positions
 * still point at the right line.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text.charAt(index) !== '\n') index++;
    } else if (char === '/' && next === '*') {
      const close = text.indexOf('*/', index + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(index, end).replace(/[^\n]/g, '');
      index = end;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** The index just after the closing quote of the string that starts at `start`. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\') index += 2;
    else if (char === '"') return index + 1;
    else index++;
  }
  return text.length;
}
