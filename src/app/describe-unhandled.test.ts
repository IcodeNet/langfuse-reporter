import { describe, expect, it } from 'vitest';
import { describeUnhandled } from './describe-unhandled.js';

function withCode(code: string): Error {
  return Object.assign(new Error(`${code}: raw system text`), { code });
}

describe('describeUnhandled', () => {
  it('should say the disk is full and how to go on when the error code is ENOSPC', () => {
    expect(describeUnhandled(withCode('ENOSPC'))).toBe(
      'The disk is full, so the file could not be written. Free some space or choose another folder with --out <folder>. Nothing partial was left behind.',
    );
  });

  it('should say the folder is read-only when the error code is EROFS', () => {
    expect(describeUnhandled(withCode('EROFS'))).toContain('read-only');
  });

  it('should name the missing permission when the error code is EACCES', () => {
    expect(describeUnhandled(withCode('EACCES'))).toContain('no permission');
  });

  it('should keep the original message when the error code is not known', () => {
    expect(describeUnhandled(withCode('EWHATEVER'))).toBe('EWHATEVER: raw system text');
  });

  it('should keep the message when the error has no code', () => {
    expect(describeUnhandled(new Error('plain failure'))).toBe('plain failure');
  });

  it('should print a thrown string as it is when the value is not an error', () => {
    expect(describeUnhandled('text only')).toBe('text only');
  });
});
