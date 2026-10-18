import { stripControlCharacters } from '../ui/untrusted-text.js';

const REDACTED = '[redacted]';

/** Every secret value this run holds, in the forms a server could echo back: as given, and as the Basic header carries it. */
export interface Secrets {
  readonly values: ReadonlyArray<string | undefined>;
}

function variants(value: string): string[] {
  const forms = new Set<string>([value]);
  forms.add(Buffer.from(value).toString('base64'));
  forms.add(encodeURIComponent(value));
  return [...forms].filter((form) => form.length >= 6);
}

/**
 * Text that came from a server (a status line, an error body) with every held secret replaced, and
 * with control characters removed. A server or gateway can echo the header it was sent, so nothing
 * it says is shown before this runs. Pairs such as public:secret are covered by the caller listing the
 * joined pair as one value.
 */
export function scrubServerText(text: string, secrets: ReadonlyArray<string | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const form of variants(secret)) result = result.split(form).join(REDACTED);
  }
  result = result.replace(/(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`);
  return stripControlCharacters(result);
}
