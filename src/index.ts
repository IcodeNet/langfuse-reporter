import { describeUnhandled } from './app/describe-unhandled.js';
import { buildProgram } from './cli.js';
import { LangfuseProblem, describeProblem } from './langfuse/langfuse-problem.js';

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  if (err instanceof LangfuseProblem) console.error(describeProblem(err));
  else console.error(describeUnhandled(err));
  process.exitCode = 1;
}
