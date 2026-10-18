import { getHeapStatistics } from 'node:v8';

/** Measured on real September turns: mean 641 bytes, p95 1.2 KB, max 1.7 KB of question and answer. */
const BYTES_PER_TURN = 700;
/** Turns fetched per rated answer: the rated one plus the rest of its conversation (mean about 4). */
const TURNS_PER_RATING = 4;
/**
 * An Excel row repeats the conversation text in several cells, and the workbook is built in memory.
 * Measured runs of 1000, 5000, 20000 and 50000 ratings used 65, 187, 454 and 1635 MB above a bare
 * start, about 32 KB per rating; 16 leaves room for longer answers than the ones measured.
 */
const MEMORY_MULTIPLIER = 16;
/** Memory in use before any rating is read (Node, the libraries, the interactive session). */
const FIXED_MB = 80;
/** Past this many ratings the run asks first, whatever the memory estimate says. */
export const CONFIRM_ABOVE_RATINGS = 5_000;
/** Past this many ratings the run refuses unless forced; the Excel write alone takes many seconds. */
export const REFUSE_ABOVE_RATINGS = 25_000;
/** Share of the heap limit a run may plan to use, leaving room for Node itself. */
const HEAP_SHARE = 0.6;

type SizeVerdict = 'ok' | 'confirm' | 'refuse';

export interface SizeCheck {
  verdict: SizeVerdict;
  ratings: number;
  /** Estimated peak memory in megabytes. */
  estimatedMb: number;
  /** Heap budget in megabytes. */
  budgetMb: number;
  /** Plain-words reason and what to do, empty when ok. */
  advice: string;
}

export interface SizeInput {
  ratings: number;
  heapLimitBytes?: number;
}

function currentHeapLimit(): number {
  return getHeapStatistics().heap_size_limit;
}

/**
 * The most turns a run may hold, from the ratings counted before any text was read. Twice the
 * estimate leaves room for long conversations; past it the run stops instead of exhausting memory.
 */
export function turnBudgetFor(ratings: number): number {
  return Math.max(1_000, ratings * TURNS_PER_RATING * 2);
}

export function estimateMemoryMb(ratings: number): number {
  const bytes = ratings * TURNS_PER_RATING * BYTES_PER_TURN * MEMORY_MULTIPLIER;
  return FIXED_MB + Math.ceil(bytes / 1_048_576);
}

/**
 * Judges a run from the number of rating scores, which is known before any text is downloaded,
 * so a window that is too big is stopped while it is still cheap to stop.
 */
export function checkSize({ ratings, heapLimitBytes = currentHeapLimit() }: SizeInput): SizeCheck {
  const estimatedMb = estimateMemoryMb(ratings);
  const budgetMb = Math.floor((heapLimitBytes * HEAP_SHARE) / 1_048_576);
  const base = { ratings, estimatedMb, budgetMb };
  if (ratings > REFUSE_ABOVE_RATINGS || estimatedMb > budgetMb) {
    return {
      verdict: 'refuse',
      ...base,
      advice: `${ratings} ratings need roughly ${estimatedMb} MB and the limit here is about ${budgetMb} MB. Choose a shorter window (window <from> <to>, or --from and --to), or add --force-large to try anyway.`,
    };
  }
  if (ratings > CONFIRM_ABOVE_RATINGS) {
    return {
      verdict: 'confirm',
      ...base,
      advice: `${ratings} ratings is a large run (roughly ${estimatedMb} MB, and it takes a while). Add --yes to go ahead, or choose a shorter window.`,
    };
  }
  return { verdict: 'ok', ...base, advice: '' };
}
