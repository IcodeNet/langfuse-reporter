import { describe, expect, it } from 'vitest';
import { limitConcurrency, QueueFullError } from './limit-concurrency.js';

function gate(): { wait: () => Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { wait: () => opened, open };
}

describe('limitConcurrency', () => {
  it('should never run more than the allowed number at once when many calls arrive together', async () => {
    const door = gate();
    let active = 0;
    let highest = 0;
    const limited = limitConcurrency(
      async () => {
        active += 1;
        highest = Math.max(highest, active);
        await door.wait();
        active -= 1;
      },
      { running: 2, waiting: 10 },
    );

    const calls = Array.from({ length: 6 }, () => limited());
    await new Promise((resolve) => setTimeout(resolve, 10));
    door.open();
    await Promise.all(calls);

    expect(highest).toBe(2);
  });

  it('should reject at once with QueueFullError when the waiting line is full', async () => {
    const door = gate();
    const limited = limitConcurrency(() => door.wait(), { running: 1, waiting: 1 });

    const first = limited();
    const second = limited();
    const third = limited();

    await expect(third).rejects.toBeInstanceOf(QueueFullError);
    door.open();
    await Promise.all([first, second]);
  });

  it('should start the next waiting call when a running call fails', async () => {
    let calls = 0;
    const limited = limitConcurrency(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('first fails');
        return 'second ok';
      },
      { running: 1, waiting: 5 },
    );

    const first = limited().catch((err: Error) => err.message);
    const second = limited();

    expect([await first, await second]).toEqual(['first fails', 'second ok']);
  });
});
