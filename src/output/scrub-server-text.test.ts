import { describe, expect, it } from 'vitest';
import { scrubServerText } from './scrub-server-text.js';

const PUBLIC = 'pk-lf-0123456789abcdef';
const SECRET = 'sk-lf-fedcba9876543210';
const PAIR = `${PUBLIC}:${SECRET}`;
const HELD = [PUBLIC, SECRET, PAIR];

describe('scrubServerText', () => {
  it('should replace a key when the server repeats it in plain text', () => {
    expect(scrubServerText(`Unauthorized for ${PUBLIC}`, HELD)).toBe('Unauthorized for [redacted]');
  });

  it('should replace the pair when the server decodes the Basic header and echoes both keys', () => {
    expect(scrubServerText(`Unauthorized for ${PAIR}`, HELD)).not.toMatch(/pk-lf|sk-lf/);
  });

  it('should replace the base64 form when the server echoes the header value', () => {
    const encoded = Buffer.from(PAIR).toString('base64');

    expect(scrubServerText(`bad header ${encoded}`, HELD)).not.toContain(encoded);
  });

  it('should replace a value after Bearer or Basic even when it is not a held key', () => {
    expect(scrubServerText('seen Bearer abc.def-123 and Basic Zm9vOmJhcg==', [])).toBe(
      'seen Bearer [redacted] and Basic [redacted]',
    );
  });

  it('should replace a URL-encoded form of a secret', () => {
    const odd = 'sk/with+odd chars';

    expect(scrubServerText(`got ${encodeURIComponent(odd)}`, [odd])).toBe('got [redacted]');
  });

  it('should strip control characters so a hostile line cannot move the cursor', () => {
    expect(scrubServerText('ok\u001b[2Jgone\u0007', [])).toBe('okgone');
  });

  it('should leave ordinary text alone when no secret appears', () => {
    expect(scrubServerText('Unauthorized', HELD)).toBe('Unauthorized');
  });

  it('should ignore a held value that is empty or very short so ordinary words are not erased', () => {
    expect(scrubServerText('Not Found for a', ['', undefined, 'a'])).toBe('Not Found for a');
  });
});
