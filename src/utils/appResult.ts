import type { AppError } from '../errors/appError.js';

export type AppResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export type AppAsync<T> = Promise<AppResult<T>>;

export function ok<T>(value: T): AppResult<T> {
  return { ok: true, value };
}

export function err(error: AppError): AppResult<never> {
  return { ok: false, error };
}

export function map<T, U>(result: AppResult<T>, fn: (value: T) => U): AppResult<U> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function andThen<T, U>(result: AppResult<T>, fn: (value: T) => AppResult<U>): AppResult<U> {
  return result.ok ? fn(result.value) : result;
}

export function match<T, U>(
  result: AppResult<T>,
  handlers: { ok: (value: T) => U; err: (error: AppError) => U }
): U {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error);
}

export function tryCatch<T>(fn: () => T, onError: (cause: unknown) => AppError): AppResult<T> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onError(cause));
  }
}

export async function fromPromise<T>(
  promise: Promise<T>,
  onError: (cause: unknown) => AppError
): AppAsync<T> {
  try {
    return ok(await promise);
  } catch (cause) {
    return err(onError(cause));
  }
}

