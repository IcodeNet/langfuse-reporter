import { readFileSync } from 'node:fs';
import { packagePath } from '../package-root.js';

/** The version in package.json, read once, so the banner, the run sheet and `--version` always agree. */
export const CLI_VERSION: string = (
  JSON.parse(readFileSync(packagePath('package.json'), 'utf8')) as { version: string }
).version;
