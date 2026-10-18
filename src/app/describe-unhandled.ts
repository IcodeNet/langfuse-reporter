/** The common file-system errors in plain words, each with the way out. Unknown codes return undefined. */
const FILE_PROBLEMS: Readonly<Record<string, string>> = {
  ENOSPC:
    'The disk is full, so the file could not be written. Free some space or choose another folder with --out <folder>. Nothing partial was left behind.',
  EROFS:
    'That folder is read-only, so the file could not be written. Choose another folder with --out <folder>.',
  EACCES:
    'You have no permission for that file or folder. Choose another folder with --out <folder>, or change its permissions.',
  EPERM:
    'The system refused that file operation. Choose another folder with --out <folder>, or change its permissions.',
  EMFILE:
    'Too many files are open at once. Close other programs, or run again with a smaller window.',
  EDQUOT:
    'Your disk quota is used up. Free some space or choose another folder with --out <folder>.',
};

/** The error code Node puts on a failed file or network call, or undefined for any other error. */
function codeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

/** What to print for an error that no command handled: a plain sentence for a known file problem, else the message. */
export function describeUnhandled(err: unknown): string {
  const code = codeOf(err);
  const known = code === undefined ? undefined : FILE_PROBLEMS[code];
  if (known) return known;
  return err instanceof Error ? err.message : String(err);
}
