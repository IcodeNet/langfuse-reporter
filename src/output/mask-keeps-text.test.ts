import { describe, expect, it } from 'vitest';
import { createMasker } from './mask.js';

/**
 * The masker must not eat ordinary text. Every line here is something a customer or an assistant says
 * that looks a little like personal data but is not, and must come out exactly as it went in.
 */
const MUST_STAY: string[] = [
  'The rate is 4.25% over 12 months, up from 3.9%.',
  'Version 1.2.3.4 was released on 2026.09.01.',
  'Call us between 9.00 and 17.30 on weekdays.',
  'Reference number 123456789 was not found.',
  'Order 2026-09-01-0001 shipped.',
  'The balance was 1,234,567.89 pounds.',
  'Open at 0900 or 1730 on Monday 01/09/2026.',
  'Pi is 3.14159265358979 to fourteen places.',
  'Page 12 of 345, section 6.7.8.9.',
  'Your ISA allowance is 20000 this tax year.',
  'Account type: ABCD1234 is a product code, not a bank number.',
  'Use PRODUCT-CODE-ALPHA-2026 to apply.',
  'Postcode SW1A 1AA and EC1A 1BB are fine.',
  'We are open 24/7 and on 0800 days, rarely.',
  'Dates: 2026-09-01, 2026-10-01, 20260901.',
];

describe('the masker leaves ordinary text alone', () => {
  const masker = createMasker('s');

  it.each(MUST_STAY)('should keep %j exactly as written', (text) => {
    expect(masker.text(text)).toBe(text);
  });
});
