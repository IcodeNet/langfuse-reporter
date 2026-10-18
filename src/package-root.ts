import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The folder that holds this package's package.json, found by walking up from the running file. The
 * same code runs from `src/` in a checkout and from one bundled file in `dist/` after install, and
 * those sit at different depths, so no path may count `../` from its own file.
 */
function findPackageRoot(): string {
  let folder = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(folder, 'package.json'))) return folder;
    const parent = dirname(folder);
    if (parent === folder) throw new Error("Cannot find this package's folder");
    folder = parent;
  }
}

export const PACKAGE_ROOT = findPackageRoot();

/** True when the package was installed from npm, where its own folder must not be written to. */
export const IS_INSTALLED = PACKAGE_ROOT.split(/[\\/]/).includes('node_modules');

/** A file or folder shipped inside the package. */
export function packagePath(...parts: string[]): string {
  return join(PACKAGE_ROOT, ...parts);
}
