import { brand } from '../brand/brand.js';
import {
  buildDocsPrompt,
  loadDocPages,
  searchSections,
  splitSections,
} from '../docs/docs-library.js';
import { createLlmClient, LlmSetupError } from '../llm/llm-client.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { Reporter } from '../ui/reporter.js';

/** Past this many characters a pasted question is probably a mistake, and it would be sent to the model. */
const MAX_QUESTION_CHARS = 2_000;

/** One question and the answer the model gave, kept so a follow-up question has its context. */
export interface DocsExchange {
  question: string;
  answer: string;
}

/** How many earlier exchanges follow a new question to the model; older ones are dropped first. */
export const MAX_REMEMBERED_EXCHANGES = 4;

export interface DocsRequest {
  resolved: ResolvedConfig;
  reporter: Reporter;
  question: string;
  /** Earlier exchanges of this session, oldest first. Omit for a one-off question (the shell command). */
  history?: DocsExchange[];
}

/** The earlier exchanges as model messages, newest {@link MAX_REMEMBERED_EXCHANGES} only. */
export function historyMessages(
  history: readonly DocsExchange[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.slice(-MAX_REMEMBERED_EXCHANGES).flatMap((exchange) => [
    { role: 'user' as const, content: exchange.question },
    { role: 'assistant' as const, content: exchange.answer },
  ]);
}

/** Shown when no model is set up: the best matching parts of the docs, found without any model. */
async function offlineAnswer({ reporter, question }: DocsRequest, reason: string): Promise<void> {
  const pages = await loadDocPages();
  const hits = searchSections(pages.flatMap(splitSections), question);
  const stop = /[.!?]$/.test(reason) ? '' : '.';
  reporter.warn(`${reason}${stop} Showing the most relevant parts of the docs instead.`);
  if (hits.length === 0) {
    reporter.info('Nothing in the docs matches that. Try other words, or set up a model.');
    return;
  }
  for (const hit of hits) {
    reporter.document(hit.text, `📖 ${hit.page}: ${hit.heading}`);
  }
}

/** Answers a question about the CLI from the bundled docs, with a model when one is set up. */
export async function runDocs(request: DocsRequest): Promise<void> {
  const { resolved, reporter, question } = request;
  const asked = question.trim();
  if (!asked) {
    reporter.warn(
      `Ask something, for example: ${brand.command} docs "why does it need chat-turn observations"`,
    );
    return;
  }
  if (asked.length > MAX_QUESTION_CHARS) {
    reporter.warn(`That question is over ${MAX_QUESTION_CHARS} characters. Please shorten it.`);
    return;
  }
  let client;
  try {
    client = createLlmClient({ settings: resolved.llm, apiKey: resolved.llmApiKey });
  } catch (err) {
    if (!(err instanceof LlmSetupError)) throw err;
    await offlineAnswer(request, err.message);
    return;
  }
  const pages = await loadDocPages();
  const task = reporter.task(`Asking ${client.describe()} about the docs`, 'docs');
  try {
    const answer = await client.complete({
      system: buildDocsPrompt(pages),
      messages: [...historyMessages(request.history ?? []), { role: 'user', content: asked }],
    });
    request.history?.push({ question: asked, answer });
    task.succeed('Answer from the docs');
    reporter.document(answer.trim(), `📖 ${brand.name} · docs`);
  } catch (err) {
    task.fail(`The model call failed: ${err instanceof Error ? err.message : String(err)}`);
    await offlineAnswer(request, 'The model could not be reached.');
  }
}
