/**
 * Utility exports for the agent abstraction layer.
 */

export {
  createSessionId,
  parseSessionId,
  getProviderFromSessionId,
  createPendingSessionId,
  isPendingSessionId,
  type ParsedSessionId,
} from './session-id.js';

export {
  withRetry,
  createRetrier,
  delay,
  type RetryOptions,
} from './retry.js';

/**
 * Generate a UUID v4.
 */
export function generateUUID(): string {
  // Use crypto.randomUUID if available (Node.js 14.17+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get current ISO 8601 timestamp.
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Type guard for non-null/undefined values.
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Assert that a value is defined, throwing if not.
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined');
  }
}

/**
 * Safe JSON stringify that handles circular references.
 */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet();

  return JSON.stringify(value, (_key, val: unknown) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    return val;
  });
}

/**
 * Deep clone an object using JSON serialization.
 *
 * Note: Does not preserve functions, dates, or other non-JSON types.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Check if running in Node.js environment.
 */
export function isNode(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  );
}

/**
 * Check if a file exists at the given path.
 *
 * Only works in Node.js environment.
 */
export async function fileExists(path: string): Promise<boolean> {
  if (!isNode()) {
    throw new Error('fileExists can only be used in Node.js environment');
  }

  try {
    const fs = await import('node:fs/promises');
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file as text.
 *
 * Only works in Node.js environment.
 */
export async function readFile(path: string): Promise<string> {
  if (!isNode()) {
    throw new Error('readFile can only be used in Node.js environment');
  }

  const fs = await import('node:fs/promises');
  return fs.readFile(path, 'utf-8');
}

/**
 * Read a JSON file and parse it.
 *
 * Only works in Node.js environment.
 */
export async function readJson<T = unknown>(path: string): Promise<T> {
  const content = await readFile(path);
  return JSON.parse(content) as T;
}
