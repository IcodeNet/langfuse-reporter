import { describe, expect, it } from 'vitest';
import { activePreset, PRESETS } from '../../ui/src/dates.js';

const NOW = new Date('2026-10-19T10:00:00Z');

describe('activePreset', () => {
  it('should name the 7 day preset when the dates are the last 7 days', () => {
    expect(activePreset('2026-10-13', '2026-10-20', NOW)).toBe('7d');
  });

  it('should name the last month preset when the dates are the whole of last month', () => {
    expect(activePreset('2026-09-01', '2026-10-01', NOW)).toBe('last-month');
  });

  it('should name the 30 day preset when the dates are the last 30 days', () => {
    expect(activePreset('2026-09-20', '2026-10-20', NOW)).toBe('30d');
  });

  it('should return nothing when a date was edited by hand to something no preset gives', () => {
    expect(activePreset('2026-10-14', '2026-10-20', NOW)).toBeUndefined();
  });

  it('should return nothing when the dates are empty', () => {
    expect(activePreset('', '', NOW)).toBeUndefined();
  });

  it('should give every preset a different window when they are listed', () => {
    const windows = PRESETS.map((preset) => JSON.stringify(preset.window(NOW)));

    expect(new Set(windows).size).toBe(PRESETS.length);
  });
});
