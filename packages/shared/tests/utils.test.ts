/**
 * Tests for shared utilities
 */

import { describe, it, expect } from 'vitest';
import {
  generateUUID,
  now,
  expiresIn,
  isExpired,
  clamp,
  safeJsonParse,
  omit,
  pick,
} from '../src/utils/index.js';

describe('generateUUID', () => {
  it('should generate a valid UUID v4', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('should generate unique UUIDs', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });
});

describe('now', () => {
  it('should return an ISO 8601 timestamp', () => {
    const timestamp = now();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('should return current time', () => {
    const before = Date.now();
    const timestamp = now();
    const after = Date.now();
    const parsed = new Date(timestamp).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe('expiresIn', () => {
  it('should return a timestamp in the future', () => {
    const expires = expiresIn(7);
    const expiresDate = new Date(expires);
    const nowDate = new Date();
    const diffDays = (expiresDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });
});

describe('isExpired', () => {
  it('should return false for null', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('should return true for past timestamps', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  it('should return false for future timestamps', () => {
    const future = new Date(Date.now() + 10000).toISOString();
    expect(isExpired(future)).toBe(false);
  });
});

describe('clamp', () => {
  it('should return the value if within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('should return min if value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('should return max if value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('safeJsonParse', () => {
  it('should parse valid JSON', () => {
    const result = safeJsonParse('{"a":1}', {});
    expect(result).toEqual({ a: 1 });
  });

  it('should return fallback for invalid JSON', () => {
    const result = safeJsonParse('not json', { default: true });
    expect(result).toEqual({ default: true });
  });
});

describe('omit', () => {
  it('should remove specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = omit(obj, ['b']);
    expect(result).toEqual({ a: 1, c: 3 });
  });

  it('should not modify original object', () => {
    const obj = { a: 1, b: 2 };
    omit(obj, ['a']);
    expect(obj).toEqual({ a: 1, b: 2 });
  });
});

describe('pick', () => {
  it('should keep only specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = pick(obj, ['a', 'c']);
    expect(result).toEqual({ a: 1, c: 3 });
  });

  it('should ignore missing keys', () => {
    const obj = { a: 1 };
    const result = pick(obj, ['a', 'b' as keyof typeof obj]);
    expect(result).toEqual({ a: 1 });
  });
});
