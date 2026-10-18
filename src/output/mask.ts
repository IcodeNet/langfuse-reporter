import { createHash, randomBytes } from 'node:crypto';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/**
 * An IBAN in any case, with spaces, hyphens or none between groups. After the bank code each group
 * must hold a digit, so the ordinary word that follows an IBAN is not swallowed with it.
 */
const IBAN =
  /\b[A-Z]{2}\d{2}[ -]?[A-Z0-9]{4}(?:[ -]?(?=[A-Z0-9]{0,3}\d)[A-Z0-9]{4}){1,6}(?:[ -]?(?=[A-Z0-9]{0,3}\d)[A-Z0-9]{1,4})?\b/gi;
/** Real IBANs carry far more digits than this; a few letters and digits that merely look alike stay readable. */
const IBAN_MIN_DIGITS = 8;
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;
/** Card numbers written as four groups of four with dots; a plain decimal such as 3.14159 is not matched. */
const CARD_DOTTED = /\b\d{4}(?:\.\d{4}){2,3}(?:\.\d{1,3})?\b/g;
const NATIONAL_INSURANCE = /\b[A-CEGHJ-PR-TW-Z]{2}[ .-]?\d{2}[ .-]?\d{2}[ .-]?\d{2}[ .-]?[A-D]\b/gi;
/** A number that starts with a plus or 00 and a country code, with an optional (0) after it. */
const PHONE_INTERNATIONAL =
  /(?<![\w.])(?:\+|00)\d{1,3}[ .-]?(?:\(0\)[ .-]?)?\d(?:[ .-]?\d){8,11}\b/g;
/** A UK-style number with an area code in brackets, such as (020) 7946 0958. */
const PHONE_BRACKETED = /(?<![\w.])\(0\d{2,4}\)[ .-]?\d(?:[ .-]?\d){5,8}\b/g;
const PHONE = /(?<![\w.])0\d(?:[ .-]?\d){8,11}\b/g;

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
  const isCard = (match: string): string =>
    passesLuhn(match.replaceAll(/[ .-]/g, '')) ? '[card]' : match;
  return text.replace(CARD_CANDIDATE, isCard).replace(CARD_DOTTED, isCard);
}

function maskIbans(text: string): string {
  return text.replace(IBAN, (match) =>
    (match.match(/\d/g)?.length ?? 0) >= IBAN_MIN_DIGITS ? '[iban]' : match,
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
      maskCards(maskIbans(text.replace(EMAIL, '[email]')))
        .replace(NATIONAL_INSURANCE, '[ni-number]')
        .replace(PHONE_INTERNATIONAL, '[phone]')
        .replace(PHONE_BRACKETED, '[phone]')
        .replace(PHONE, '[phone]'),
  };
}
