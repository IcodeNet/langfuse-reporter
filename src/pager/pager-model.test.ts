import { describe, expect, it } from 'vitest';
import {
  findHits,
  handleKey,
  initialState,
  type PagerKey,
  type PagerLine,
  type PagerScreen,
  type PagerState,
} from './pager-model.js';

function lines(count: number): PagerLine[] {
  return Array.from({ length: count }, (_unused, index) => ({
    text: `line ${index}`,
    kind: 'body' as const,
  }));
}

const SCREEN: PagerScreen = { lines: lines(100), height: 20 };

function press(state: PagerState, ...keys: PagerKey[]): ReturnType<typeof handleKey> {
  return keys.reduce<ReturnType<typeof handleKey>>(
    (step, key) => handleKey(step.state, key, SCREEN),
    { state, quit: false },
  );
}

const typed = (text: string): PagerKey[] => text.split('').map((sequence) => ({ sequence }));
const named = (name: string): PagerKey => ({ name, sequence: '' });

describe('handleKey movement', () => {
  it('should move one line down when j or the down arrow is pressed', () => {
    expect([
      press(initialState(), { sequence: 'j' }).state.top,
      press(initialState(), named('down')).state.top,
    ]).toEqual([1, 1]);
  });

  it('should move one line up but never above the first line when k is pressed', () => {
    const down = press(initialState(), { sequence: 'j' }, { sequence: 'j' }).state;

    expect([
      press(down, { sequence: 'k' }).state.top,
      press(initialState(), { sequence: 'k' }).state.top,
    ]).toEqual([1, 0]);
  });

  it('should move a page less one line when space is pressed, and back when b is pressed', () => {
    const forward = press(initialState(), named('space')).state;

    expect([forward.top, press(forward, { sequence: 'b' }).state.top]).toEqual([19, 0]);
  });

  it('should move half a page when d or u is pressed', () => {
    const down = press(initialState(), { sequence: 'd' }).state;

    expect([down.top, press(down, { sequence: 'u' }).state.top]).toEqual([10, 0]);
  });

  it('should go to the top with g and to the last full screen with G when the keys are pressed', () => {
    const bottom = press(initialState(), { sequence: 'G' }).state;

    expect([bottom.top, press(bottom, { sequence: 'g' }).state.top]).toEqual([80, 0]);
  });

  it('should stop at the last full screen when the user keeps paging down', () => {
    const far = press(initialState(), ...Array.from({ length: 12 }, () => named('space'))).state;

    expect(far.top).toBe(80);
  });
});

describe('handleKey leaving', () => {
  it.each([
    ['q', { sequence: 'q' }],
    ['Esc', named('escape')],
    ['Ctrl+C', { name: 'c', ctrl: true, sequence: '\u0003' }],
  ])('should leave the report when %s is pressed', (_label, key) => {
    expect(press(initialState(), key).quit).toBe(true);
  });

  it('should leave the report when :q and Enter are typed', () => {
    const step = press(initialState(), { sequence: ':' }, ...typed('q'), named('return'));

    expect(step.quit).toBe(true);
  });

  it('should leave the report when :q! or :quit is typed', () => {
    expect([
      press(initialState(), { sequence: ':' }, ...typed('q!'), named('return')).quit,
      press(initialState(), { sequence: ':' }, ...typed('quit'), named('return')).quit,
    ]).toEqual([true, true]);
  });

  it('should stay and say so when an unknown command is typed after a colon', () => {
    const step = press(initialState(), { sequence: ':' }, ...typed('wq'), named('return'));

    expect([step.quit, step.state.message]).toEqual([false, 'Not a command: :wq   (:q leaves)']);
  });

  it('should only cancel the typing and stay when Esc is pressed after a colon', () => {
    const step = press(initialState(), { sequence: ':' }, ...typed('q'), named('escape'));

    expect([step.quit, step.state.mode]).toEqual([false, 'view']);
  });

  it('should not leave when q is typed inside a search', () => {
    const step = press(initialState(), { sequence: '/' }, ...typed('q'));

    expect([step.quit, step.state.input]).toEqual([false, 'q']);
  });
});

describe('handleKey search', () => {
  it('should jump to the first line with the text when a search is entered', () => {
    const step = press(initialState(), { sequence: '/' }, ...typed('line 42'), named('return'));

    expect([step.state.top, step.state.hits]).toEqual([42, [42]]);
  });

  it('should step to the next and the previous hit when n or N is pressed', () => {
    const screen: PagerScreen = { lines: lines(100), height: 20 };
    const first = handleKey(initialState(), { sequence: '/' }, screen).state;
    const typedState = 'line 4'
      .split('')
      .reduce((state, sequence) => handleKey(state, { sequence }, screen).state, first);
    const searched = handleKey(typedState, named('return'), screen).state;

    const next = handleKey(searched, { sequence: 'n' }, screen).state;
    const back = handleKey(next, { sequence: 'N' }, screen).state;

    expect([searched.top, next.top, back.top]).toEqual([4, 40, 4]);
  });

  it('should wrap round to the first hit when n is pressed on the last one', () => {
    const screen: PagerScreen = { lines: lines(100), height: 20 };
    let state = handleKey(initialState(), { sequence: '/' }, screen).state;
    for (const sequence of 'line 9'.split('')) state = handleKey(state, { sequence }, screen).state;
    state = handleKey(state, named('return'), screen).state;

    const hits = state.hits.length;
    for (let i = 0; i < hits; i++) state = handleKey(state, { sequence: 'n' }, screen).state;

    expect(state.hitPos).toBe(0);
  });

  it('should say the pattern was not found when nothing matches', () => {
    const step = press(initialState(), { sequence: '/' }, ...typed('zzz'), named('return'));

    expect(step.state.message).toBe('Pattern not found: zzz');
  });

  it('should ignore case when the search is lower case and match case when it has a capital', () => {
    const rows: PagerLine[] = [
      { text: 'Hello', kind: 'body' },
      { text: 'hello', kind: 'body' },
    ];

    expect([findHits(rows, 'hello'), findHits(rows, 'Hello')]).toEqual([[0, 1], [0]]);
  });
});

describe('handleKey rating jumps', () => {
  it('should jump to the next rating heading when ] is pressed and back with [', () => {
    const rows: PagerLine[] = lines(60).map((line, index) =>
      index % 20 === 5 ? { ...line, kind: 'heading' as const } : line,
    );
    const screen: PagerScreen = { lines: rows, height: 10 };

    const first = handleKey(initialState(), { sequence: ']' }, screen).state;
    const second = handleKey(first, { sequence: ']' }, screen).state;
    const back = handleKey(second, { sequence: '[' }, screen).state;

    expect([first.top, second.top, back.top]).toEqual([5, 25, 5]);
  });
});
