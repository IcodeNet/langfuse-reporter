import { describe, expect, it } from 'vitest';
import { makeMockResolvedConfig } from '../config/__mocks__/makeMockResolvedConfig.mock.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { Reporter } from '../ui/reporter.js';
import {
  historyMessages,
  MAX_REMEMBERED_EXCHANGES,
  runDocs,
  type DocsExchange,
} from './run-docs.js';

function makeReporter(): { reporter: Reporter; lines: string[] } {
  const lines: string[] = [];
  const task = {
    update: () => undefined,
    succeed: (text?: string) => void lines.push(`ok ${text ?? ''}`),
    fail: (text?: string) => void lines.push(`fail ${text ?? ''}`),
  };
  const reporter: Reporter = {
    task: () => task,
    done: (text) => void lines.push(text),
    info: (text) => void lines.push(`info ${text}`),
    note: (text) => void lines.push(text),
    styled: (text) => void lines.push(text),
    document: (text) => void lines.push(text),
    warn: (text) => void lines.push(`warn ${text}`),
    block: (block) => void lines.push(block.title),
    section: (_title, body) => Promise.resolve(body()),
    cancel: () => undefined,
  };
  return { reporter, lines };
}

function makeResolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return makeMockResolvedConfig({ outDir: '/tmp/r', ...overrides });
}

describe('runDocs', () => {
  it('should ask for a question when none is given', async () => {
    const { reporter, lines } = makeReporter();

    await runDocs({ resolved: makeResolved(), reporter, question: '   ' });

    expect(lines.join('\n')).toContain('Ask something');
  });

  it('should refuse the question when it is very long', async () => {
    const { reporter, lines } = makeReporter();

    await runDocs({ resolved: makeResolved(), reporter, question: 'x'.repeat(3_000) });

    expect(lines.join('\n')).toContain('Please shorten it');
  });

  it('should say no model is set up and still show the matching docs when there is none', async () => {
    const { reporter, lines } = makeReporter();

    await runDocs({
      resolved: makeResolved(),
      reporter,
      question: 'what is a chat-turn observation',
    });

    const text = lines.join('\n');
    expect(text).toContain('No model is set up');
    expect(text).toContain('chat-turn');
  });

  it('should say nothing matched when the question shares no word with the docs', async () => {
    const { reporter, lines } = makeReporter();

    await runDocs({ resolved: makeResolved(), reporter, question: 'zebra xylophone' });

    expect(lines.join('\n')).toContain('Nothing in the docs matches that');
  });

  it('should send the docs to the model and print its answer when a model is set up', async () => {
    const { reporter, lines } = makeReporter();
    const original = globalThis.fetch;
    let sent = '';
    globalThis.fetch = (_input, init) => {
      sent = init?.body as string;
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'Because scores sit on turns.' } }] }),
        ),
      );
    };
    try {
      await runDocs({
        resolved: makeResolved({
          llm: { provider: 'openai', model: 'm' },
          llmApiKey: 'k',
        }),
        reporter,
        question: 'why turn level scores',
      });
    } finally {
      globalThis.fetch = original;
    }

    expect(lines.join('\n')).toContain('Because scores sit on turns.');
    expect(sent).toContain('=== langfuse-setup ===');
  });

  it('should fall back to the docs and say why when the model call fails', async () => {
    const { reporter, lines } = makeReporter();
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('denied', { status: 401 }));
    try {
      await runDocs({
        resolved: makeResolved({ llm: { provider: 'openai', model: 'm' }, llmApiKey: 'k' }),
        reporter,
        question: 'what is a chat-turn observation',
      });
    } finally {
      globalThis.fetch = original;
    }

    const text = lines.join('\n');
    expect(text).toContain('The model call failed');
    expect(text).toContain('Showing the most relevant parts of the docs');
  });
});

describe('historyMessages', () => {
  const exchange = (n: number): DocsExchange => ({ question: `q${n}`, answer: `a${n}` });

  it('should turn each exchange into a user message then an assistant message when the history is sent', () => {
    expect(historyMessages([exchange(1)])).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
  });

  it('should keep the order of the exchanges when the history is sent', () => {
    expect(historyMessages([exchange(1), exchange(2)]).map((m) => m.content)).toEqual([
      'q1',
      'a1',
      'q2',
      'a2',
    ]);
  });

  it('should keep only the newest exchanges when there are more than the limit', () => {
    const many = Array.from({ length: MAX_REMEMBERED_EXCHANGES + 3 }, (_, i) => exchange(i + 1));

    const kept = historyMessages(many);

    expect(kept).toHaveLength(MAX_REMEMBERED_EXCHANGES * 2);
    expect(kept[0]?.content).toBe('q4');
  });

  it('should send nothing when there is no history', () => {
    expect(historyMessages([])).toEqual([]);
  });
});

describe('runDocs memory', () => {
  async function ask(question: string, history: DocsExchange[] | undefined): Promise<string> {
    const { reporter } = makeReporter();
    const original = globalThis.fetch;
    let sent = '';
    globalThis.fetch = (_input, init) => {
      sent = init?.body as string;
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: `reply to ${question}` } }] }),
        ),
      );
    };
    try {
      await runDocs({
        resolved: makeResolved({ llm: { provider: 'openai', model: 'm' }, llmApiKey: 'k' }),
        reporter,
        question,
        history,
      });
    } finally {
      globalThis.fetch = original;
    }
    return sent;
  }

  it('should send earlier questions and answers with a follow-up when a history is kept', async () => {
    const history: DocsExchange[] = [];
    await ask('what is a turn', history);

    const sent = await ask('and why', history);

    const messages = (JSON.parse(sent) as { messages: Array<{ role: string; content: string }> })
      .messages;
    expect(messages.slice(1).map((m) => [m.role, m.content])).toEqual([
      ['user', 'what is a turn'],
      ['assistant', 'reply to what is a turn'],
      ['user', 'and why'],
    ]);
  });

  it('should add the new exchange to the history when the answer succeeds', async () => {
    const history: DocsExchange[] = [];

    await ask('first', history);

    expect(history).toEqual([{ question: 'first', answer: 'reply to first' }]);
  });

  it('should send only the question when no history is kept, as the shell command does', async () => {
    const sent = await ask('alone', undefined);

    const messages = (JSON.parse(sent) as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(2);
  });

  it('should not add the exchange to the history when the call fails', async () => {
    const { reporter } = makeReporter();
    const history: DocsExchange[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('no', { status: 500 }));
    try {
      await runDocs({
        resolved: makeResolved({ llm: { provider: 'openai', model: 'm' }, llmApiKey: 'k' }),
        reporter,
        question: 'q',
        history,
      });
    } finally {
      globalThis.fetch = original;
    }

    expect(history).toEqual([]);
  });
});
