import { describe, expect, it } from 'vitest';
import { createMasker } from './mask.js';

/** Every written form of a personal value a customer might type, and the part that must not survive masking. */
const FORMS: Array<[string, string, string]> = [
  ['NI spaces', 'NI AB 12 34 56 C ok', 'AB 12 34 56 C'],
  ['NI hyphens', 'NI AB-12-34-56-C ok', 'AB-12-34-56-C'],
  ['NI no separators', 'NI AB123456C ok', 'AB123456C'],
  ['NI lower case', 'ni ab 12 34 56 c ok', 'ab 12 34 56 c'],
  ['NI dots', 'NI AB.12.34.56.C ok', 'AB.12.34.56.C'],
  ['IBAN spaced', 'iban GB82 WEST 1234 5698 7654 32 ok', 'GB82 WEST 1234 5698 7654 32'],
  ['IBAN compact', 'iban GB82WEST12345698765432 ok', 'GB82WEST12345698765432'],
  ['IBAN lower compact', 'iban gb82west12345698765432 ok', 'gb82west12345698765432'],
  ['IBAN lower spaced', 'iban gb82 west 1234 5698 7654 32 ok', 'gb82 west 1234 5698 7654 32'],
  ['IBAN hyphens', 'iban GB82-WEST-1234-5698-7654-32 ok', 'GB82-WEST-1234-5698-7654-32'],
  ['phone 07', 'call 07700 900123 ok', '07700 900123'],
  ['phone +44', 'call +44 7700 900123 ok', '+44 7700 900123'],
  ['phone +44 (0)', 'call +44 (0)7700 900123 ok', '+44 (0)7700 900123'],
  ['phone +44 (0) spaced', 'call +44 (0) 7700 900123 ok', '+44 (0) 7700 900123'],
  ['phone bracket area', 'call (020) 7946 0958 ok', '(020) 7946 0958'],
  ['phone bracket area 2', 'call (0207) 946 0958 ok', '(0207) 946 0958'],
  ['phone hyphens', 'call 020-7946-0958 ok', '020-7946-0958'],
  ['phone dots', 'call 020.7946.0958 ok', '020.7946.0958'],
  ['phone 0044', 'call 0044 7700 900123 ok', '0044 7700 900123'],
  ['card spaces', 'card 4111 1111 1111 1111 ok', '4111 1111 1111 1111'],
  ['card hyphens', 'card 4111-1111-1111-1111 ok', '4111-1111-1111-1111'],
  ['card dots', 'card 4111.1111.1111.1111 ok', '4111.1111.1111.1111'],
  ['card plain', 'card 4111111111111111 ok', '4111111111111111'],
  ['card amex', 'card 3782 822463 10005 ok', '3782 822463 10005'],
  ['email', 'mail a.b+c@example.co.uk ok', 'a.b+c@example.co.uk'],
];

describe('the masker hides every written form of a personal value', () => {
  const masker = createMasker('s');

  it.each(FORMS)('should hide the %s form when it appears in a sentence', (_name, text, value) => {
    expect(masker.text(text)).not.toContain(value);
  });

  it('should keep the words around a personal value when only the value is hidden', () => {
    expect(masker.text('NI AB-12-34-56-C ok')).toBe('NI [ni-number] ok');
    expect(masker.text('iban gb82west12345698765432 ok')).toBe('iban [iban] ok');
    expect(masker.text('call +44 (0)7700 900123 ok')).toBe('call [phone] ok');
    expect(masker.text('call (020) 7946 0958 ok')).toBe('call [phone] ok');
    expect(masker.text('card 4111.1111.1111.1111 ok')).toBe('card [card] ok');
  });

  it('should keep a dotted number that fails the Luhn check when it only looks like a card', () => {
    expect(masker.text('part 1234.5678.9012.3456 ok')).toBe('part 1234.5678.9012.3456 ok');
  });
});
