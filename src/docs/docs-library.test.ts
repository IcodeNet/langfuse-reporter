import { describe, expect, it } from 'vitest';
import {
  buildDocsPrompt,
  loadDocPages,
  searchSections,
  splitSections,
  type DocPage,
} from './docs-library.js';

const PAGE: DocPage = {
  name: 'guide',
  text: [
    '# Title',
    'intro words',
    '## Turns',
    'Every answer is a chat-turn observation with a session id.',
    '## Scores',
    'Each thumb is a score on the turn it rated, named feedback_helpful.',
    '## Privacy',
    'Exports hold customer text.',
  ].join('\n'),
};

describe('splitSections', () => {
  it('should split a page at its headings when it has several', () => {
    expect(splitSections(PAGE).map((section) => section.heading)).toEqual([
      'Title',
      'Turns',
      'Scores',
      'Privacy',
    ]);
  });

  it('should keep the text with its own heading only when a document is split', () => {
    expect(splitSections(PAGE)[2]?.text).toBe(
      'Each thumb is a score on the turn it rated, named feedback_helpful.',
    );
  });

  it('should skip a heading when it has no text under it', () => {
    const page: DocPage = { name: 'p', text: '# Empty\n## Full\nbody' };

    expect(splitSections(page).map((section) => section.heading)).toEqual(['Full']);
  });
});

describe('searchSections', () => {
  const sections = splitSections(PAGE);

  it('should put the section about the asked score first when the question names it', () => {
    expect(searchSections(sections, 'what is feedback_helpful')[0]?.heading).toBe('Scores');
  });

  it('should rank a heading match above a body match when both exist', () => {
    expect(searchSections(sections, 'privacy turn')[0]?.heading).toBe('Privacy');
  });

  it('should ignore filler words when ranking', () => {
    expect(searchSections(sections, 'how do i the a')).toEqual([]);
  });

  it('should return nothing when no section shares a word with the question', () => {
    expect(searchSections(sections, 'zebra')).toEqual([]);
  });

  it('should return no more sections than the limit when many match', () => {
    expect(searchSections(sections, 'turn score customer', 2)).toHaveLength(2);
  });
});

describe('buildDocsPrompt', () => {
  it('should include every page under its name when building the prompt', () => {
    const prompt = buildDocsPrompt([PAGE, { name: 'other', text: 'second page' }]);

    expect(prompt).toContain('=== guide ===');
    expect(prompt).toContain('=== other ===\nsecond page');
  });

  it('should tell the model to answer only from the pages when building the prompt', () => {
    expect(buildDocsPrompt([PAGE])).toContain('Answer only from the documentation below');
  });
});

describe('loadDocPages', () => {
  it('should load the Langfuse setup guide when the library is read from the package', async () => {
    const pages = await loadDocPages();

    expect(pages.map((page) => page.name)).toEqual([
      'langfuse-setup',
      'readme',
      'config-reference',
    ]);
    expect(pages[0]?.text).toContain('chat-turn');
  });
});
