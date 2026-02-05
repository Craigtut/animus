/**
 * Tests for utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
  createSessionId,
  parseSessionId,
  getProviderFromSessionId,
  createPendingSessionId,
  isPendingSessionId,
  generateUUID,
  now,
  isDefined,
  assertDefined,
  safeStringify,
  deepClone,
} from '../../src/utils/index.js';

describe('createSessionId', () => {
  it('creates session ID in correct format', () => {
    const id = createSessionId('claude', 'abc-123');
    expect(id).toBe('claude:abc-123');
  });

  it('handles colons in native ID', () => {
    const id = createSessionId('opencode', 'server:session:123');
    expect(id).toBe('opencode:server:session:123');
  });

  it('throws for empty native ID', () => {
    expect(() => createSessionId('claude', '')).toThrow();
  });
});

describe('parseSessionId', () => {
  it('parses valid session ID', () => {
    const { provider, nativeId } = parseSessionId('claude:abc-123');
    expect(provider).toBe('claude');
    expect(nativeId).toBe('abc-123');
  });

  it('handles colons in native ID', () => {
    const { provider, nativeId } = parseSessionId('opencode:server:session:123');
    expect(provider).toBe('opencode');
    expect(nativeId).toBe('server:session:123');
  });

  it('throws for empty input', () => {
    expect(() => parseSessionId('')).toThrow();
  });

  it('throws for missing colon', () => {
    expect(() => parseSessionId('invalid')).toThrow();
  });

  it('throws for invalid provider', () => {
    expect(() => parseSessionId('invalid:abc-123')).toThrow();
  });
});

describe('getProviderFromSessionId', () => {
  it('extracts provider from session ID', () => {
    expect(getProviderFromSessionId('claude:abc')).toBe('claude');
    expect(getProviderFromSessionId('codex:xyz')).toBe('codex');
    expect(getProviderFromSessionId('opencode:123')).toBe('opencode');
  });

  it('throws for invalid format', () => {
    expect(() => getProviderFromSessionId('invalid')).toThrow();
  });
});

describe('createPendingSessionId', () => {
  it('creates pending ID with correct prefix', () => {
    const id = createPendingSessionId('claude');
    expect(id).toMatch(/^claude:pending-\d+-[a-z0-9]+$/);
  });

  it('creates unique IDs', () => {
    const id1 = createPendingSessionId('claude');
    const id2 = createPendingSessionId('claude');
    expect(id1).not.toBe(id2);
  });
});

describe('isPendingSessionId', () => {
  it('returns true for pending IDs', () => {
    const id = createPendingSessionId('codex');
    expect(isPendingSessionId(id)).toBe(true);
  });

  it('returns false for regular IDs', () => {
    expect(isPendingSessionId('claude:abc-123')).toBe(false);
  });
});

describe('generateUUID', () => {
  it('generates valid UUID format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique UUIDs', () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    expect(uuid1).not.toBe(uuid2);
  });
});

describe('now', () => {
  it('returns ISO 8601 timestamp', () => {
    const timestamp = now();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});

describe('isDefined', () => {
  it('returns true for defined values', () => {
    expect(isDefined('string')).toBe(true);
    expect(isDefined(0)).toBe(true);
    expect(isDefined(false)).toBe(true);
    expect(isDefined({})).toBe(true);
  });

  it('returns false for null', () => {
    expect(isDefined(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDefined(undefined)).toBe(false);
  });
});

describe('assertDefined', () => {
  it('does not throw for defined values', () => {
    expect(() => assertDefined('value')).not.toThrow();
    expect(() => assertDefined(0)).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => assertDefined(null)).toThrow('Expected value to be defined');
  });

  it('throws for undefined', () => {
    expect(() => assertDefined(undefined)).toThrow('Expected value to be defined');
  });

  it('uses custom message', () => {
    expect(() => assertDefined(null, 'Custom message')).toThrow('Custom message');
  });
});

describe('safeStringify', () => {
  it('stringifies simple objects', () => {
    const result = safeStringify({ a: 1, b: 'two' });
    expect(result).toBe('{"a":1,"b":"two"}');
  });

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;

    const result = safeStringify(obj);
    expect(result).toBe('{"a":1,"self":"[Circular]"}');
  });

  it('handles nested circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.nested = { parent: obj };

    const result = safeStringify(obj);
    expect(result).toContain('[Circular]');
  });
});

describe('deepClone', () => {
  it('clones simple objects', () => {
    const original = { a: 1, b: 'two' };
    const clone = deepClone(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
  });

  it('clones nested objects', () => {
    const original = { a: { b: { c: 1 } } };
    const clone = deepClone(original);

    expect(clone).toEqual(original);
    expect(clone.a).not.toBe(original.a);
    expect(clone.a.b).not.toBe(original.a.b);
  });

  it('clones arrays', () => {
    const original = [1, 2, { a: 3 }];
    const clone = deepClone(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
  });
});
