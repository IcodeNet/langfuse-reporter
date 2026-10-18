import { ITEM_OPEN } from '../presets/chat-feedback/analyse-feedback.js';
import type { LlmClient } from '../llm/llm-client.js';

const ITEM = new RegExp(
  `${ITEM_OPEN} (\\d+)\\nrating: (thumbs up|thumbs down)\\nticked: ([^\\n]*)`,
  'g',
);

interface Group {
  name: string;
  description: string;
  rows: number[];
}

/** Sorts the items of a batch by rating and first ticked reason; no model is called. */
function groupItems(text: string): Group[] {
  const groups = new Map<string, Group>();
  for (const [, number, rating, ticked] of text.matchAll(ITEM)) {
    const reason = (ticked ?? '').split(',')[0]?.trim() ?? 'none';
    const up = rating === 'thumbs up';
    const name = `${up ? 'Works: ' : ''}${reason.replaceAll('_', ' ')}`;
    const group = groups.get(name) ?? {
      name,
      description: `Sample grouping: ratings whose first ticked reason is "${reason}".`,
      rows: [],
    };
    group.rows.push(Number(number));
    groups.set(name, group);
  }
  return [...groups.values()];
}

/** A stand-in for the model in demo mode. It groups by reason with plain code, so the demo needs no key and sends nothing anywhere. */
export function createDemoLlmClient(): LlmClient {
  return {
    describe: () => 'demo grouping (no model is called)',
    async complete(request) {
      const isGrouping = request.system.includes(ITEM_OPEN);
      const content = request.messages.map((message) => message.content).join('\n');
      return isGrouping
        ? JSON.stringify({ themes: groupItems(content) })
        : JSON.stringify({ merged: [] });
    },
  };
}
