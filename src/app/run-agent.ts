import { readFile } from 'node:fs/promises';
import { packagePath } from '../package-root.js';
import { withBrandNames } from '../docs/docs-library.js';

/** The procedure a coding agent follows, read from the same page `jeves docs` and the browser Docs tab show. */
export async function agentProcedure(): Promise<string> {
  return withBrandNames(await readFile(packagePath('docs', 'agent-setup.md'), 'utf8'));
}

/** Prints the procedure on stdout, so an agent that can only run commands can read it and nothing else is needed. */
export async function runAgent(): Promise<void> {
  process.stdout.write(`${await agentProcedure()}\n`);
}
