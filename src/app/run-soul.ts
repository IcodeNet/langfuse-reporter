import { brand } from '../brand/brand.js';
import type { AppContext } from './app-context.js';
import { soulInviteLines } from './soul-invite.js';
import { soulLines } from './soul.js';
import { createPalette } from '../ui/ansi.js';

/** Box characters need a real terminal that speaks UTF-8; a pipe, a log or a plain console gets + - | instead. */
export function canDrawBoxes(interactive: boolean, env: NodeJS.ProcessEnv): boolean {
  const locale = `${env.LC_ALL ?? ''}${env.LC_CTYPE ?? ''}${env.LANG ?? ''}`.toLowerCase();
  return interactive && env.TERM !== 'linux' && env.TERM !== 'dumb' && locale.includes('utf');
}

/** Prints the tour of what the tool does; it reads no config and makes no network call. */
export async function runSoul(
  app: Pick<AppContext, 'reporter' | 'color' | 'columns' | 'interactive'>,
): Promise<void> {
  const lines = soulLines({
    columns: app.columns,
    unicode: canDrawBoxes(app.interactive, process.env),
    paint: createPalette(app.color),
  });
  await app.reporter.section(`${brand.name} · soul`, () => app.reporter.styled(lines.join('\n')));
}

/** The welcome card that points a new user at `soul`; shown once, when the session opens. */
export function showSoulInvite(
  app: Pick<AppContext, 'reporter' | 'color' | 'columns' | 'interactive'>,
): void {
  const lines = soulInviteLines({
    columns: app.columns,
    unicode: canDrawBoxes(app.interactive, process.env),
    paint: createPalette(app.color),
  });
  app.reporter.styled(lines.join('\n'));
}
