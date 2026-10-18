/** Thrown when the queue is full, so the caller can answer 503 at once instead of piling up more work. */
export class QueueFullError extends Error {
  constructor() {
    super('Too many requests are waiting');
    this.name = 'QueueFullError';
  }
}

/**
 * Limits how many runs go at once and how many may wait. Each run starts a whole new program, so an
 * unlimited burst of requests would start that many processes together.
 */
export function limitConcurrency<Args extends unknown[], Result>(
  run: (...args: Args) => Promise<Result>,
  { running, waiting }: { running: number; waiting: number },
): (...args: Args) => Promise<Result> {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = (): void => {
    active -= 1;
    queue.shift()?.();
  };

  return async (...args) => {
    if (active >= running) {
      if (queue.length >= waiting) throw new QueueFullError();
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await run(...args);
    } finally {
      release();
    }
  };
}
