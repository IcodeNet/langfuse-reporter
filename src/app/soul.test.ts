import { describe, expect, it } from 'vitest';
import { SESSION_COMMANDS } from '../session/session-commands.js';
import { createPalette, stripAnsi } from '../ui/ansi.js';
import { displayWidth } from '../ui/display-width.js';
import { soulLines } from './soul.js';

const PLAIN = createPalette(false);

function lines(columns: number, unicode: boolean, color = false): string[] {
  return soulLines({ columns, unicode, paint: createPalette(color) });
}

describe('soulLines', () => {
  it.each([120, 80, 66, 50])(
    'should fit a %i column terminal when drawn with box characters',
    (columns) => {
      const widest = Math.max(...lines(columns, true).map((line) => displayWidth(line)));

      expect(widest).toBeLessThanOrEqual(columns);
    },
  );

  it('should draw the journey as one row of four boxes when the terminal is wide', () => {
    const topEdges = lines(100, true).filter((line) => line.includes('┌') && line.includes('┐'));

    expect(topEdges.map((line) => line.split('┌').length - 1)).toEqual([4]);
  });

  it('should stack the four boxes when the terminal is narrow', () => {
    const topEdges = lines(50, true).filter((line) => line.includes('┌'));

    expect(topEdges.map((line) => line.split('┌').length - 1)).toEqual([1, 1, 1, 1]);
  });

  it('should use only plain characters when unicode is off', () => {
    const nonAscii = lines(100, false).filter((line) => Buffer.byteLength(line) !== line.length);

    expect(nonAscii).toEqual([]);
  });

  it('should print no escape codes when colour is off', () => {
    expect(lines(100, true).join('\n')).toBe(stripAnsi(lines(100, true).join('\n')));
  });

  it('should say the same words when colour is on as when it is off', () => {
    const coloured = lines(100, true, true).map((line) => stripAnsi(line));

    expect(coloured).toEqual(lines(100, true));
  });

  it('should list these commands when it says what you can do', () => {
    const text = lines(100, true).join('\n');

    expect(text).toMatch(
      /What you can do\n {2}doctor.*\n {2}window 7d.*\n {2}where <filter>.*\n {2}report.*\n {2}export.*\n {2}analyse.*\n {2}compare.*\n {2}docs/,
    );
  });

  it('should only name commands the session has when it lists what you can do', () => {
    const sessionCommands = SESSION_COMMANDS.map(([name]) => name);

    expect(sessionCommands).toEqual(
      expect.arrayContaining([
        'doctor',
        'window',
        'where',
        'report',
        'export',
        'analyse',
        'compare',
        'docs',
      ]),
    );
  });

  it('should show the profile chain from the profile down to the env label when drawn', () => {
    const text = lines(100, true).join('\n');

    expect(
      ['profile', 'env file', 'project', 'env label'].map((word) => text.includes(word)),
    ).toEqual([true, true, true, true]);
  });

  it('should end with the first-report steps and where to get help when drawn', () => {
    const last = lines(100, true).slice(-8).join('\n');

    expect(last).toContain('Your first report');
    expect(last).toContain('docs <your question>');
  });

  it('should be the same on every call when nothing about the run changes', () => {
    expect(soulLines({ columns: 100, unicode: true, paint: PLAIN })).toEqual(lines(100, true));
  });
});
