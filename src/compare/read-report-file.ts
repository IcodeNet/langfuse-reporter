import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

/** A report with tens of thousands of long conversations stays well under this. */
const MAX_REPORT_BYTES = 200 * 1024 * 1024;

/** Non-blocking so opening a named pipe returns at once and is refused, not waited on. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK;

/**
 * Reads a report file the user named. It is opened once and checked through that handle, so it
 * cannot be swapped for a pipe or a device between the check and the read.
 */
export async function readSmallBinaryFile(path: string): Promise<Buffer> {
  const absolute = resolve(path);
  let handle;
  try {
    handle = await open(absolute, OPEN_FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`${absolute} does not exist`, { cause: err });
    throw new Error(`Cannot open ${absolute}: ${code ?? 'unknown error'}`, { cause: err });
  }
  try {
    const facts = await handle.stat();
    if (!facts.isFile()) throw new Error(`${absolute} is not a regular file`);
    if (facts.size > MAX_REPORT_BYTES) throw new Error(`${absolute} is too large to compare`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
