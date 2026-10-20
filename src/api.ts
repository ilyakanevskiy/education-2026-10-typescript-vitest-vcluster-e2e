import { ApiException } from '@kubernetes/client-node';

export const isApiError = (error: unknown, code: number): boolean =>
  error instanceof ApiException && error.code === code;

/**
 * Runs a read and returns `null` only when the API answers 404. Any other failure
 * (403, connection error, wrong context) propagates, so it can't pass for "absent".
 */
export async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (isApiError(error, 404)) return null;
    throw error;
  }
}

/** The `Status` object the API server returns with an error response. */
export interface ApiStatus {
  code: number;
  reason?: string;
  message?: string;
}

/**
 * Runs a call that the API server is expected to reject and returns the rejection's
 * `Status`. A call that succeeds, or fails without an API response, fails the test.
 */
export async function rejection(call: () => Promise<unknown>): Promise<ApiStatus> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof ApiException)) throw error;
    const body: unknown = typeof error.body === 'string' ? JSON.parse(error.body) : error.body;
    const status = (body ?? {}) as Partial<ApiStatus>;
    return { code: error.code, reason: status.reason, message: status.message };
  }
  throw new Error('expected the API server to reject the call, but it succeeded');
}

/** Deletes and treats 404 as success: cleanup must not fail on what is already gone. */
export async function deleteIfExists(remove: () => Promise<unknown>): Promise<void> {
  await readOrNull(remove);
}
