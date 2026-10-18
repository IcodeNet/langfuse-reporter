import brandFile from '../../brand.json' with { type: 'json' };

/**
 * The one place the product's names live. `brand.json` at the package root holds them; every
 * message, the banner, the prompt and the config folder are built from here, so a rename is one
 * edit in that file (plus a build for the package metadata and the docs).
 */
export interface Brand {
  /** How the product is written in sentences and the banner: "Jeves". */
  name: string;
  /** What a user types in a shell: "jeves". */
  command: string;
  /** Other names that start the same program. */
  aliases: readonly string[];
  /** The launcher script the command names point at, relative to the package. */
  launcher: string;
  /** Folder under the user's config home that holds config.json. */
  configDir: string;
}

/** The session prompt without the profile: "jeves" in jeves[dev]>. */
export function promptWord(source: Brand): string {
  return source.name.toLowerCase();
}

export const brand: Brand = {
  name: brandFile.name,
  command: brandFile.command,
  aliases: brandFile.aliases,
  launcher: brandFile.launcher,
  configDir: brandFile.configDir,
};

/** `jeves config check`: a command line a user can paste, with the configured command name. */
export function cmd(rest: string): string {
  return `${brand.command} ${rest}`.trim();
}
