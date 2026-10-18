import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Config and env files are a few hundred bytes; anything near this size is not one. */
const MAX_READABLE_BYTES = 1024 * 1024;

/** Non-blocking so opening a named pipe returns at once and is refused, not waited on. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK;

interface FileFacts {
  isFile: boolean;
  size: number;
}

/** Refuses directories, pipes and devices and oversized files, judged on the open handle itself. */
function assertSmallRegularFile(path: string, { isFile, size }: FileFacts): void {
  if (!isFile) throw new Error(`${path} is not a regular file`);
  if (size > MAX_READABLE_BYTES) throw new Error(`${path} is too large to be a config file`);
}

/**
 * Reads a small text file the operator pointed at. The file is opened once and checked through
 * that handle, so it cannot be swapped for something else between the check and the read.
 */
export async function readSmallTextFile(path: string): Promise<string> {
  const absolute = resolve(path);
  const handle = await open(absolute, OPEN_FLAGS);
  try {
    const facts = await handle.stat();
    assertSmallRegularFile(absolute, { isFile: facts.isFile(), size: facts.size });
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}

export function readSmallTextFileSync(path: string): string {
  const absolute = resolve(path);
  const descriptor = openSync(absolute, OPEN_FLAGS);
  try {
    const facts = fstatSync(descriptor);
    assertSmallRegularFile(absolute, { isFile: facts.isFile(), size: facts.size });
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}
