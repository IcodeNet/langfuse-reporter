import { createHash, randomBytes } from 'node:crypto';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;
const NATIONAL_INSURANCE = /\b[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi;
const PHONE = /(?<![\w.])(?:\+\d{1,3}[ -]?|0)\d(?:[ -]?\d){8,11}\b/g;

/** True when the digits pass the Luhn check that real card numbers satisfy, so a long reference number is not hidden as a card. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let doubleNext = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleNext) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleNext = !doubleNext;
  }
  return sum % 10 === 0;
}

function maskCards(text: string): string {
  return text.replace(CARD_CANDIDATE, (match) =>
    passesLuhn(match.replaceAll(/[ -]/g, '')) ? '[card]' : match,
  );
}

export interface Masker {
  /** A short code for a user id; the same id gives the same code within one masker. Empty stays empty. */
  userId: (id: string) => string;
  /** The text with emails, bank account numbers, card numbers, National Insurance numbers and phone numbers replaced. */
  text: (text: string) => string;
}

/**
 * The salt is random per run by default, so a code cannot be reversed by hashing guessed ids and
 * is not comparable between runs.
 */
export function createMasker(salt: string = randomBytes(16).toString('hex')): Masker {
  return {
    userId: (id) =>
      id === ''
        ? ''
        : `user-${createHash('sha256').update(`${salt}:${id}`).digest('hex').slice(0, 8)}`,
    text: (text) =>
      maskCards(text.replace(EMAIL, '[email]').replace(IBAN, '[iban]'))
        .replace(NATIONAL_INSURANCE, '[ni-number]')
        .replace(PHONE, '[phone]'),
  };
}
