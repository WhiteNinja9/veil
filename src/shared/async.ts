export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Retries `fn` with exponential backoff. `shouldRetry` can veto retries for fatal errors. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts: number; baseDelayMs: number; shouldRetry?: (error: unknown) => boolean },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (options.shouldRetry && !options.shouldRetry(error)) break;
      if (attempt < options.attempts - 1) await sleep(options.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Leading+trailing throttle: runs at most once per `ms`, always delivering the last call. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  return (...args: A) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0 && !timer) {
      last = now;
      fn(...args);
      return;
    }
    pending = args;
    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        last = Date.now();
        if (pending) fn(...pending);
        pending = undefined;
      }, Math.max(remaining, 0));
    }
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
