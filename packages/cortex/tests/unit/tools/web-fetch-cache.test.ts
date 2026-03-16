import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebFetchCache } from '../../../src/tools/web-fetch/cache.js';

describe('WebFetchCache', () => {
  let cache: WebFetchCache;

  beforeEach(() => {
    // Use a short TTL for testing
    cache = new WebFetchCache(1000); // 1 second TTL
  });

  afterEach(() => {
    cache.destroy();
  });

  it('stores and retrieves entries', () => {
    cache.set('https://example.com', {
      content: 'test content',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://example.com',
    });

    const entry = cache.get('https://example.com');
    expect(entry).toBeDefined();
    expect(entry!.content).toBe('test content');
    expect(entry!.statusCode).toBe(200);
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('https://nonexistent.com')).toBeUndefined();
  });

  it('expires entries after TTL', async () => {
    cache.set('https://example.com', {
      content: 'test',
      fetchedAt: Date.now() - 2000, // 2 seconds ago (past 1s TTL)
      statusCode: 200,
      finalUrl: 'https://example.com',
    });

    expect(cache.get('https://example.com')).toBeUndefined();
  });

  it('reports size correctly', () => {
    expect(cache.size).toBe(0);

    cache.set('https://a.com', {
      content: 'a',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://a.com',
    });
    expect(cache.size).toBe(1);

    cache.set('https://b.com', {
      content: 'b',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://b.com',
    });
    expect(cache.size).toBe(2);
  });

  it('clears all entries', () => {
    cache.set('https://a.com', {
      content: 'a',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://a.com',
    });
    cache.set('https://b.com', {
      content: 'b',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://b.com',
    });

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('has() returns true for valid entries', () => {
    cache.set('https://example.com', {
      content: 'test',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://example.com',
    });

    expect(cache.has('https://example.com')).toBe(true);
    expect(cache.has('https://other.com')).toBe(false);
  });

  it('cleanup removes expired entries', () => {
    cache.set('https://expired.com', {
      content: 'old',
      fetchedAt: Date.now() - 2000,
      statusCode: 200,
      finalUrl: 'https://expired.com',
    });
    cache.set('https://fresh.com', {
      content: 'new',
      fetchedAt: Date.now(),
      statusCode: 200,
      finalUrl: 'https://fresh.com',
    });

    expect(cache.size).toBe(2);
    cache.cleanup();
    expect(cache.size).toBe(1);
    expect(cache.has('https://fresh.com')).toBe(true);
  });

  it('destroy stops the cleanup timer', () => {
    cache.destroy();
    expect(cache.size).toBe(0);
  });
});
