/**
 * What went wrong when talking to Langfuse, in words a person can act on. Each kind carries the
 * message to show and the thing to try next, so the same words appear in the screen, in doctor and
 * in the browser page.
 */

export type LangfuseProblemKind =
  | 'bad-keys'
  | 'no-access'
  | 'wrong-address'
  | 'server-down'
  | 'busy'
  | 'not-langfuse'
  | 'unreadable'
  | 'wrong-shape'
  | 'no-answer'
  | 'cannot-connect'
  | 'endless-pages';

export class LangfuseProblem extends Error {
  constructor(
    readonly kind: LangfuseProblemKind,
    message: string,
    /** What to try next. Never contains a key. */
    readonly fix: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LangfuseProblem';
  }
}

/** The message and the next step together, for places that print one line. */
export function describeProblem(problem: LangfuseProblem): string {
  return `${problem.message} ${problem.fix}`;
}

export function problemForStatus(
  path: string,
  status: number,
  statusText: string,
): LangfuseProblem {
  const said = `Langfuse ${path} answered ${status} ${statusText}.`;
  if (status === 401) {
    return new LangfuseProblem(
      'bad-keys',
      said,
      'The keys were not accepted. Check LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the env file, and that they belong to the project at this address and region.',
    );
  }
  if (status === 403) {
    return new LangfuseProblem(
      'no-access',
      said,
      'These keys are not allowed to read this data. Use a key pair created for this project.',
    );
  }
  if (status === 404) {
    return new LangfuseProblem(
      'wrong-address',
      said,
      'Nothing is at this address. It should be the Langfuse address itself (for example https://cloud.langfuse.com), with no path after it.',
    );
  }
  if (status === 429) {
    return new LangfuseProblem(
      'busy',
      said,
      'Langfuse is limiting how fast it answers. Wait a minute and run the command again, or choose a shorter window.',
    );
  }
  if (status >= 500) {
    return new LangfuseProblem(
      'server-down',
      said,
      'Langfuse had an error on its side. Check its status page or your own server, then run the command again.',
    );
  }
  return new LangfuseProblem(
    'unreadable',
    said,
    'This is not an answer the tool expects. Check the address and the keys.',
  );
}

export function problemForBody(path: string, cause: unknown): LangfuseProblem {
  return new LangfuseProblem(
    'not-langfuse',
    `Langfuse ${path} answered with something that is not data.`,
    'The address may point at a web page, a login screen or a proxy, not the Langfuse API. Open it in a browser: it should show Langfuse, and the API lives under /api/public.',
    { cause },
  );
}

export function problemForShape(path: string, expected: string): LangfuseProblem {
  return new LangfuseProblem(
    'wrong-shape',
    `Langfuse ${path} answered in a shape the tool does not know (expected ${expected}).`,
    'The Langfuse version may be newer or older than this tool supports. Run doctor, and report this message with the Langfuse version.',
  );
}

export function problemForNoAnswer(path: string, seconds: number): LangfuseProblem {
  return new LangfuseProblem(
    'no-answer',
    `Langfuse ${path} did not answer within ${seconds} seconds.`,
    'Check that the address is reachable from this computer (VPN, proxy, firewall) and that the server is running.',
  );
}

export function problemForConnection(address: string, cause: unknown): LangfuseProblem {
  return new LangfuseProblem(
    'cannot-connect',
    `Could not connect to ${address}.`,
    'Check the address (and the port for a self-hosted Langfuse), that the server is running, and your network.',
    { cause },
  );
}

export function problemForEndlessPages(path: string, pages: number): LangfuseProblem {
  return new LangfuseProblem(
    'endless-pages',
    `Langfuse ${path} sent the same page marker again after ${pages} page${pages === 1 ? '' : 's'}, so reading would never end.`,
    'The server keeps returning the same cursor. Choose a shorter window, and report this if it repeats.',
  );
}
