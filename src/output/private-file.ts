import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import type { Workbook } from 'exceljs';

/** Owner can read and write; nobody else. Exports hold customer questions and answers. */
const OWNER_ONLY = 0o600;

/** Create-only and never through a symbolic link, so a planted file or link cannot receive the data. */
const CREATE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

/**
 * Moves the finished file over the final name. Windows refuses to rename over an existing file, so
 * on that refusal the old file (or a link planted in its place; unlink removes the link, never what
 * it points to) is removed first and the rename tried once more.
 */
export async function replaceFile(
  temporary: string,
  path: string,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  try {
    await move(temporary, path);
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? err.code : undefined;
    if (code !== 'EEXIST' && code !== 'EPERM') throw err;
    await unlink(path);
    await move(temporary, path);
  }
}

/**
 * Writes a file so it is owner-only from the moment it exists. The data goes to a uniquely named
 * temporary file that must not already exist (created with mode 0600), then it is renamed over
 * the final name. The handle is closed before any rename or delete because Windows refuses both
 * on an open file. There is never a world-readable copy, and a failed write never leaves a
 * half-written export.
 */
async function writePrivateBytes(
  path: string,
  makeBytes: () => Promise<Uint8Array>,
): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temporary, CREATE_FLAGS, OWNER_ONLY);
  try {
    await handle.writeFile(await makeBytes());
    await handle.sync();
    await handle.close();
    await replaceFile(temporary, path);
  } catch (err) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw err;
  }
}

export async function writePrivateWorkbook(workbook: Workbook, path: string): Promise<void> {
  await writePrivateBytes(path, async () => new Uint8Array(await workbook.xlsx.writeBuffer()));
}

export async function writePrivateText(text: string, path: string): Promise<void> {
  await writePrivateBytes(path, async () => new TextEncoder().encode(text));
}
