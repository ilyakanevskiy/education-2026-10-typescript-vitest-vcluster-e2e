import { setTimeout as sleep } from 'node:timers/promises';

export const POLL_INTERVAL_MS = 1_000;
export const SHORT_TIMEOUT_MS = 30_000;
export const LONG_TIMEOUT_MS = 120_000;

/** One poll attempt: either the expected value, or a description of what was seen instead. */
export type Attempt<T> = { done: true; value: T } | { done: false; state: string };

export const done = <T>(value: T): Attempt<T> => ({ done: true, value });
export const pending = (state: string): Attempt<never> => ({ done: false, state });

/**
 * Repeats `attempt` until it reports `done`. An attempt that throws fails the poll
 * immediately — expected intermediate states are returned as `pending`, not thrown.
 * On timeout the error names what was awaited and the last state seen.
 */
export async function poll<T>(
  what: string,
  attempt: () => Promise<Attempt<T>>,
  timeoutMs: number = SHORT_TIMEOUT_MS,
): Promise<T> {
  // Monotonic clock: a system clock adjustment doesn't stretch or cut the timeout.
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const result = await attempt();
    if (result.done) return result.value;
    if (performance.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}; last state: ${result.state}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
