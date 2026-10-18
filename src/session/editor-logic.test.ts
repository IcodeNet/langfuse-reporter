import { describe, expect, it } from 'vitest';
import {
  applicable,
  applySuggestion,
  arrowTarget,
  moveSelection,
  visibleWindow,
} from './editor-logic.js';

describe('moveSelection', () => {
  it('should pick the first item when Down is pressed with nothing selected', () => {
    expect(moveSelection(undefined, 4, 1)).toBe(0);
  });

  it('should pick the last item when Up is pressed with nothing selected', () => {
    expect(moveSelection(undefined, 4, -1)).toBe(3);
  });

  it('should wrap to the first item when Down is pressed on the last', () => {
    expect(moveSelection(3, 4, 1)).toBe(0);
  });

  it('should wrap to the last item when Up is pressed on the first', () => {
    expect(moveSelection(0, 4, -1)).toBe(3);
  });

  it('should step one item at a time when moving inside the list', () => {
    expect(moveSelection(1, 4, 1)).toBe(2);
  });

  it('should select nothing when there are no items', () => {
    expect(moveSelection(undefined, 0, 1)).toBeUndefined();
  });
});

describe('visibleWindow', () => {
  it('should show every row when the list fits', () => {
    expect(visibleWindow(2, 5, 8)).toEqual({ start: 0, end: 5 });
  });

  it('should start at the top when nothing is selected in a long list', () => {
    expect(visibleWindow(undefined, 12, 8)).toEqual({ start: 0, end: 8 });
  });

  it('should scroll so the selected row stays visible when it is past the window', () => {
    expect(visibleWindow(10, 12, 8)).toEqual({ start: 3, end: 11 });
  });

  it('should not scroll past the end when the last row is selected', () => {
    expect(visibleWindow(11, 12, 8)).toEqual({ start: 4, end: 12 });
  });
});

describe('applySuggestion', () => {
  it('should add a trailing space when a word is inserted so the next hints appear', () => {
    expect(applySuggestion('rating = ne', 9, 'negative')).toBe('rating = negative ');
  });

  it('should not add a space when an open bracket is inserted', () => {
    expect(applySuggestion('category IN ', 12, '(')).toBe('category IN (');
  });

  it('should not add a space when a closing bracket is inserted', () => {
    expect(applySuggestion('category IN (other', 18, ')')).toBe('category IN (other)');
  });
});

describe('applicable', () => {
  it('should drop hint-only suggestions when they have nothing to insert', () => {
    expect(
      applicable([
        { insert: '', hint: 'type a user' },
        { insert: 'dev', hint: 'profile' },
      ]),
    ).toEqual([{ insert: 'dev', hint: 'profile' }]);
  });
});

describe('applySuggestion quote', () => {
  it('should add no space after an opening quote when the suggestion is only a quote', () => {
    expect(applySuggestion('comment contains ', 17, '"')).toBe('comment contains "');
  });

  it('should add a space after a whole word when the suggestion is a word', () => {
    expect(applySuggestion('rating = ', 9, 'negative')).toBe('rating = negative ');
  });
});

describe('arrowTarget', () => {
  const base = {
    browsingHistory: false,
    bufferIsEmpty: false,
    hasSelection: false,
    hasChoices: true,
    direction: 1 as const,
  };

  it.each([
    ['nothing is suggested', { hasChoices: false }, 'history'],
    ['the user is already walking the history', { browsingHistory: true }, 'history'],
    [
      'Up is pressed on an empty prompt',
      { bufferIsEmpty: true, direction: -1 as const },
      'history',
    ],
    ['Down is pressed on an empty prompt', { bufferIsEmpty: true }, 'suggestions'],
    [
      'Up is pressed on an empty prompt with a suggestion highlighted',
      { bufferIsEmpty: true, hasSelection: true, direction: -1 as const },
      'suggestions',
    ],
    ['Up is pressed on typed text that has suggestions', { direction: -1 as const }, 'suggestions'],
  ])('should go to the %3$s when %1$s', (_label, change, expected) => {
    expect(arrowTarget({ ...base, ...change })).toBe(expected);
  });
});
