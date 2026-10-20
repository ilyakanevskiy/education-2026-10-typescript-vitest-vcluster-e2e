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

/** Deletes and treats 404 as success: cleanup must not fail on what is already gone. */
export async function deleteIfExists(remove: () => Promise<unknown>): Promise<void> {
  await readOrNull(remove);
}
