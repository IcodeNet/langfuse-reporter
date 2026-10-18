import { describe, expect, it } from 'vitest';
import { logoLinesFor } from './logo.js';

describe('logoLinesFor', () => {
  it('should draw Jeves exactly as the banner always has when the name is Jeves', () => {
    expect(logoLinesFor('Jeves', 120)).toEqual([
      '     ██╗███████╗██╗   ██╗███████╗███████╗',
      '     ██║██╔════╝██║   ██║██╔════╝██╔════╝',
      '     ██║█████╗  ██║   ██║█████╗  ███████╗',
      '██   ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ╚════██║',
      '╚█████╔╝███████╗ ╚████╔╝ ███████╗███████║',
      ' ╚════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝',
    ]);
  });

  it('should draw six rows of equal width when the name is any text', () => {
    const rows = logoLinesFor('Feedback-2', 200);

    expect([rows.length, new Set(rows.map((row) => row.length)).size]).toEqual([6, 1]);
  });

  it('should ignore case when drawing the name', () => {
    expect(logoLinesFor('jeves', 120)).toEqual(logoLinesFor('JEVES', 120));
  });

  it('should draw nothing when the name is too wide for the terminal', () => {
    expect(logoLinesFor('Jeves', 40)).toEqual([]);
  });

  it('should draw nothing when the name is empty', () => {
    expect(logoLinesFor('', 120)).toEqual([]);
  });

  it('should leave a blank gap when the font has no drawing for a character', () => {
    const rows = logoLinesFor('A?A', 120);

    expect(rows.every((row) => row.length === rows[0]?.length)).toBe(true);
  });
});
