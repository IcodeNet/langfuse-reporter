import { brand } from '../brand/brand.js';
import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** How long the folder check may take; a folder on a dead network share would otherwise hang. */
const CHECK_TIMEOUT_MS = 5_000;

/** Finds the nearest folder that already exists, so a missing `reports/2026/10` is judged by its parent. */
async function nearestExisting(path: string): Promise<string> {
  let current = resolve(path);
  for (;;) {
    try {
      await stat(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function problemWith(outDir: string): Promise<string | undefined> {
  const existing = await nearestExisting(outDir);
  const info = await stat(existing).catch(() => undefined);
  if (!info) return `Cannot use ${outDir}: nothing on that path exists.`;
  if (!info.isDirectory()) {
    return `Cannot write the files to ${outDir}: ${existing} is a file, not a folder.`;
  }
  try {
    await access(existing, constants.W_OK);
  } catch {
    return `Cannot write the files to ${outDir}: no permission to write in ${existing}.`;
  }
  return undefined;
}

/**
 * Checks, before anything is downloaded, that the output folder can be used. Returns the problem
 * in plain words with the way out, or undefined when the folder is fine. Never creates anything.
 */
export async function checkOutDir(outDir: string): Promise<string | undefined> {
  const fix = `Choose another folder with --out <folder>, or: ${brand.command} config set outDir <folder>`;
  const timeout = new Promise<string>((done) => {
    setTimeout(
      () => done(`Cannot reach ${outDir} (no answer after 5 seconds).`),
      CHECK_TIMEOUT_MS,
    ).unref();
  });
  const problem = await Promise.race([problemWith(outDir), timeout]);
  return problem ? `${problem} ${fix}` : undefined;
}

/** Makes the folder, turning the system error codes into the same plain words. */
export async function ensureOutDir(outDir: string): Promise<void> {
  const problem = await checkOutDir(outDir);
  if (problem) throw new Error(problem);
  await mkdir(outDir, { recursive: true });
}
