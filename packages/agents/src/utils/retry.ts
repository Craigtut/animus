/**
 * Retry utilities for the agent abstraction layer.
 *
 * Provides exponential backoff retry logic for transient failures.
 */

import { AgentError } from '../errors.js';

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;

  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;

  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;

  /** Jitter factor (0-1) to add randomness (default: 0.1) */
  jitterFactor?: number;

  /** Custom function to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;

  /** Callback invoked before each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Default retry options.
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.1,
};

/**
 * Execute a function with exponential backoff retry.
 *
 * Uses exponential backoff with optional jitter. By default, retries
 * AgentError instances with severity 'retry', and all non-AgentError
 * exceptions.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => session.prompt("Hello"),
 *   { maxRetries: 5, baseDelayMs: 2000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    baseDelayMs = DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    jitterFactor = DEFAULT_OPTIONS.jitterFactor,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = exponentialDelay * jitterFactor * Math.random();
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      // Notify retry callback
      if (onRetry) {
        onRetry(error, attempt + 1, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Default function to determine if an error should be retried.
 */
function defaultShouldRetry(error: unknown, _attempt: number): boolean {
  // AgentError instances control their own retry behavior
  if (error instanceof AgentError) {
    return error.severity === 'retry';
  }

  // Retry all other errors by default (network issues, etc.)
  return true;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a retry wrapper with pre-configured options.
 *
 * Useful when you want consistent retry behavior across multiple calls.
 *
 * @example
 * ```typescript
 * const retrier = createRetrier({ maxRetries: 5 });
 * const result = await retrier(() => session.prompt("Hello"));
 * ```
 */
export function createRetrier(
  defaultOptions: RetryOptions,
): <T>(fn: () => Promise<T>, overrideOptions?: RetryOptions) => Promise<T> {
  return <T>(fn: () => Promise<T>, overrideOptions?: RetryOptions): Promise<T> => {
    return withRetry(fn, { ...defaultOptions, ...overrideOptions });
  };
}

/**
 * Delay execution for a specified duration.
 *
 * Exported for use in tests and other utilities.
 */
export function delay(ms: number): Promise<void> {
  return sleep(ms);
}
