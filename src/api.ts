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
 * Reads the `Status` from an error response body. A body that isn't JSON (a proxy's
 * error page, plain text) becomes the message as is, so assertions on it still show
 * what came back.
 */
function parseStatus(body: unknown): Partial<ApiStatus> {
  if (typeof body !== 'string') return (body ?? {}) as Partial<ApiStatus>;
  try {
    return JSON.parse(body) as Partial<ApiStatus>;
  } catch {
    return { message: body };
  }
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
    const status = parseStatus(error.body);
    return { code: error.code, reason: status.reason, message: status.message };
  }
  throw new Error('expected the API server to reject the call, but it succeeded');
}

/** Deletes and treats 404 as success: cleanup must not fail on what is already gone. */
export async function deleteIfExists(remove: () => Promise<unknown>): Promise<void> {
  await readOrNull(remove);
}
