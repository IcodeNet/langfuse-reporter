import { brand } from '../brand/brand.js';
import { DEMO_NOTICE } from '../demo/demo-constants.js';
import type { AppContext } from './app-context.js';
import { runDoctor } from './run-doctor.js';

/** What the person can try next, each one a command that works on sample data. */
export function demoNextSteps(
  command: string = brand.command,
): ReadonlyArray<readonly [string, string]> {
  return [
    [
      `${command} --demo feedback export --format csv --out /tmp/demo`,
      'write the sample ratings to CSV files',
    ],
    [`${command} --demo analyse`, 'group the sample ratings into common problems'],
    [`${command} --demo ui`, 'open the browser page on the sample data'],
    [`${command} --demo soul`, 'a picture tour of what the tool does'],
    [`${command} --demo query run --all`, 'run the sample saved queries (exit code 1 on purpose)'],
  ];
}

/**
 * What `jeves --demo` does with no command: the interactive session needs a real config file, so a
 * newcomer gets a short guided run instead of a refusal.
 */
export async function runDemo(
  app: Pick<AppContext, 'reporter' | 'configPath' | 'profileOverride' | 'demo'>,
): Promise<void> {
  app.reporter.warn(
    `${DEMO_NOTICE}. No account or keys are needed, and some commands that change the config file are not available here.`,
  );
  await runDoctor({
    configPath: app.configPath,
    demo: true,
    profileOverride: app.profileOverride,
    reporter: app.reporter,
    now: new Date(),
  });
  app.reporter.block({
    title: 'Try these next (they all work on the sample data)',
    emoji: '🧭',
    rows: demoNextSteps(),
  });
  app.reporter.note(`When you have a Langfuse project, run: ${brand.command} ui`);
}
