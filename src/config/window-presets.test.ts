import { describe, expect, it } from 'vitest';
import { describeWindow, presetWindow, relativeBoundary } from './window-presets.js';

/** A Wednesday, so the week rules have something to prove. */
const NOW = new Date('2026-10-14T15:30:00.000Z');

describe('presetWindow', () => {
  it.each([
    ['today', '2026-10-14T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['yesterday', '2026-10-13T00:00:00.000Z', '2026-10-14T00:00:00.000Z'],
    ['7d', '2026-10-08T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['30d', '2026-09-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['this-week', '2026-10-12T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['last-week', '2026-10-05T00:00:00.000Z', '2026-10-12T00:00:00.000Z'],
    ['this-month', '2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['last-month', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
  ])('should resolve %s to the right instants when it is Wednesday 14 Oct', (word, from, to) => {
    expect(presetWindow(word, NOW)).toEqual({ from, to });
  });

  it('should ignore case and outer spaces when the word is typed loosely', () => {
    expect(presetWindow('  LAST-Week ', NOW)).toEqual(presetWindow('last-week', NOW));
  });

  it('should end tomorrow when the window includes today', () => {
    expect(presetWindow('7d', NOW)?.to).toBe('2026-10-15T00:00:00.000Z');
  });

  it('should return undefined when the word is not a preset', () => {
    expect([presetWindow('fortnight', NOW), presetWindow('2026-10-01', NOW)]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('should start the week on Monday even when today is Sunday', () => {
    const sunday = new Date('2026-10-18T09:00:00.000Z');

    expect(presetWindow('this-week', sunday)?.from).toBe('2026-10-12T00:00:00.000Z');
  });

  it('should find last month across a year boundary when it is January', () => {
    const january = new Date('2027-01-10T09:00:00.000Z');

    expect(presetWindow('last-month', january)).toEqual({
      from: '2026-12-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
  });
});

describe('relativeBoundary', () => {
  it('should mean the start of the day when the word is a start', () => {
    expect(relativeBoundary('today', NOW, false)).toBe('2026-10-14T00:00:00.000Z');
  });

  it('should mean the end of the day when the word is an end, so today is included', () => {
    expect(relativeBoundary('today', NOW, true)).toBe('2026-10-15T00:00:00.000Z');
  });

  it('should count days back when the word is -3d', () => {
    expect([relativeBoundary('-3d', NOW, false), relativeBoundary('-3d', NOW, true)]).toEqual([
      '2026-10-11T00:00:00.000Z',
      '2026-10-12T00:00:00.000Z',
    ]);
  });

  it('should return undefined when the text is a calendar date', () => {
    expect(relativeBoundary('2026-10-01', NOW, false)).toBeUndefined();
  });
});

describe('describeWindow', () => {
  it('should show one day when the window is a single day', () => {
    expect(
      describeWindow({ from: '2026-10-14T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' }),
    ).toBe('2026-10-14');
  });

  it('should show the last included day, not the excluded end, when the window spans days', () => {
    expect(
      describeWindow({ from: '2026-10-08T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' }),
    ).toBe('2026-10-08 to 2026-10-14 inclusive');
  });
});
