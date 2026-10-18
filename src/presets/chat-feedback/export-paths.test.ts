import { describe, expect, it } from 'vitest';
import { assertSafeStem } from './export-paths.js';

describe('assertSafeStem', () => {
  it('should accept a name made of letters, digits, dots, dashes and underscores', () => {
    expect(() => assertSafeStem('2026-09-01_2026-10-01_all_e3b0c44298fc1c14')).not.toThrow();
  });

  it.each(['../evil', 'a/b', 'a\\b', '..', 'a..b', '', '.hidden', 'a b', 'a'.repeat(161)])(
    'should refuse %j when the name could point outside the export folder',
    (stem) => {
      expect(() => assertSafeStem(stem)).toThrow('is not a safe file name');
    },
  );
});
