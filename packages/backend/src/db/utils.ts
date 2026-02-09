/**
 * Database utility functions for row ↔ type conversion.
 */

/**
 * Convert a snake_case DB row to camelCase TS object.
 */
export function snakeToCamel<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

/**
 * Convert a camelCase TS object to snake_case for DB inserts.
 */
export function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}

/**
 * Convert a boolean to SQLite integer (0/1).
 */
export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Convert a SQLite integer (0/1) to boolean.
 */
export function intToBool(value: number): boolean {
  return value === 1;
}
