import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brand, type Brand } from './brand.js';

/** The `bin` entry of package.json for a brand: the command and every alias run the launcher named in brand.json. */
export function binFor(names: Brand): Record<string, string> {
  return Object.fromEntries(
    [names.command, ...names.aliases].map((name) => [name, names.launcher]),
  );
}

interface PackageFile {
  bin?: Record<string, string>;
  [key: string]: unknown;
}

/** package.json with its `bin` replaced by the brand's; everything else is kept as it was. */
export function packageWithBrand(text: string, names: Brand): string {
  const file = JSON.parse(text) as PackageFile;
  file.bin = binFor(names);
  return `${JSON.stringify(file, null, 4)}\n`;
}

/** `pnpm brand:sync`: writes the configured command names into package.json after a rename. */
export function syncPackage(
  path: string = fileURLToPath(new URL('../../package.json', import.meta.url)),
): void {
  writeFileSync(path, packageWithBrand(readFileSync(path, 'utf8'), brand));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) syncPackage();
