import { describe, expect, it } from 'vitest';
import { createMasker } from './mask.js';

describe('createMasker text', () => {
  const masker = createMasker('salt');

  it('should replace an email address when the text contains one', () => {
    expect(masker.text('write to jo.smith+x@example.co.uk now')).toBe('write to [email] now');
  });

  it('should replace a card number when it passes the Luhn check', () => {
    expect(masker.text('card 4111 1111 1111 1111 expired')).toBe('card [card] expired');
  });

  it('should keep a long number when it fails the Luhn check', () => {
    expect(masker.text('reference 1234 5678 9012 3456')).toBe('reference 1234 5678 9012 3456');
  });

  it('should replace a UK phone number when it starts with 0', () => {
    expect(masker.text('call 07700 900123 today')).toBe('call [phone] today');
  });

  it('should replace an international phone number when it starts with a plus', () => {
    expect(masker.text('call +44 7700 900123 today')).toBe('call [phone] today');
  });

  it('should replace a National Insurance number when it is written with spaces', () => {
    expect(masker.text('NI is AB 12 34 56 C ok')).toBe('NI is [ni-number] ok');
  });

  it('should keep text that only looks like a National Insurance number when the prefix is not issued', () => {
    expect(masker.text('code QQ 12 34 56 C')).toBe('code QQ 12 34 56 C');
  });

  it('should replace an IBAN when the text contains one', () => {
    expect(masker.text('pay GB82 WEST 1234 5698 7654 32 please')).toBe('pay [iban] please');
  });

  it('should leave ordinary text and short numbers alone when nothing personal is present', () => {
    expect(masker.text('The rate is 4.25% over 12 months, up from 3.9%.')).toBe(
      'The rate is 4.25% over 12 months, up from 3.9%.',
    );
  });
});

describe('createMasker userId', () => {
  it('should give the same code when the same id is masked twice', () => {
    const masker = createMasker('salt');

    expect(masker.userId('U-1')).toBe(masker.userId('U-1'));
  });

  it('should give different codes when the ids differ', () => {
    const masker = createMasker('salt');

    expect(masker.userId('U-1')).not.toBe(masker.userId('U-2'));
  });

  it('should give different codes when the salt differs', () => {
    expect(createMasker('a').userId('U-1')).not.toBe(createMasker('b').userId('U-1'));
  });

  it('should not contain the original id when it is masked', () => {
    expect(createMasker('salt').userId('alice@example.com')).toMatch(/^user-[0-9a-f]{8}$/);
  });

  it('should stay empty when there is no id', () => {
    expect(createMasker('salt').userId('')).toBe('');
  });
});
