import { inflateRawSync } from 'node:zlib';

/**
 * A small reader for .xlsx files that shares no code with the writer (ExcelJS). It unzips the file,
 * reads the shared strings and the sheet cells, and returns each sheet as rows of text. It exists so
 * a mistake in the writer cannot also hide in the check that reads the file back.
 */

interface ZipEntry {
  name: string;
  data: Buffer;
}

function unzip(file: Buffer): ZipEntry[] {
  let end = file.length - 22;
  while (end >= 0 && file.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Not a zip file');
  const count = file.readUInt16LE(end + 10);
  let offset = file.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const method = file.readUInt16LE(offset + 10);
    const compressed = file.readUInt32LE(offset + 20);
    const nameLength = file.readUInt16LE(offset + 28);
    const extraLength = file.readUInt16LE(offset + 30);
    const commentLength = file.readUInt16LE(offset + 32);
    const localOffset = file.readUInt32LE(offset + 42);
    const name = file.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = file.readUInt16LE(localOffset + 26);
    const localExtraLength = file.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = file.subarray(start, start + compressed);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function textOf(xml: string): string {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => unescapeXml(match[1] ?? ''))
    .join('');
}

export type Sheet = string[][];

/** Every sheet of the workbook, by name, as rows of cell text (a missing cell is an empty string). */
export function readXlsx(file: Buffer): Record<string, Sheet> {
  const entries = new Map(unzip(file).map((entry) => [entry.name, entry.data.toString('utf8')]));
  const shared = [
    ...(entries.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((m) => textOf(m[1] ?? ''));
  const workbook = entries.get('xl/workbook.xml') ?? '';
  const rels = entries.get('xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])?.[1] ?? '',
      /Target="([^"]+)"/.exec(m[0])?.[1] ?? '',
    ]),
  );
  const sheets: Record<string, Sheet> = {};
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(match[0])?.[1] ?? '');
    const target = targets.get(/r:id="([^"]+)"/.exec(match[0])?.[1] ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const rows: Sheet = [];
    for (const rowMatch of (entries.get(path) ?? '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1] ?? '';
        const column = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? 'A';
        const index =
          [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const body = cell[2] ?? '';
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let text = '';
        if (type === 's' && value !== undefined) text = shared[Number(value)] ?? '';
        else if (type === 'inlineStr') text = textOf(body);
        else if (value !== undefined) text = unescapeXml(value);
        cells[index] = text;
      }
      rows.push(Array.from(cells, (cell) => cell ?? ''));
    }
    sheets[name] = rows;
  }
  return sheets;
}
