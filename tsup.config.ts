import { defineConfig } from 'tsup';

/**
 * One bundled file for the installed command. Dependencies stay external, so npm installs them;
 * the package's own pages, docs and brand file are read from the package folder at run time.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  external: ['commander', 'dotenv', 'zod'],
  noExternal: ['exceljs'],
});
