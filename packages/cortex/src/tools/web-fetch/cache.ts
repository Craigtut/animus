/**
 * In-memory URL cache with 15-minute TTL for WebFetch tool.
 *
 * Keyed by URL. Cached entries include the converted markdown content
 * so repeated fetches skip both the HTTP request and HTML conversion.
 *
 * Self-cleaning: expired entries are removed on access and periodically.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
  content: string;
  fetchedAt: number;
  statusCode: number;
  finalUrl: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export class WebFetchCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Unref the timer so it doesn't prevent process exit
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Get a cached entry for a URL, or undefined if not cached or expired.
   */
  get(url: string): CacheEntry | undefined {
    const entry = this.cache.get(url);
    if (!entry) return undefined;

    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.cache.delete(url);
      return undefined;
    }

    return entry;
  }

  /**
   * Store a cache entry for a URL.
   */
  set(url: string, entry: CacheEntry): void {
    this.cache.set(url, entry);
  }

  /**
   * Check if a URL has a valid (non-expired) cache entry.
   */
  has(url: string): boolean {
    return this.get(url) !== undefined;
  }

  /**
   * Remove expired entries.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [url, entry] of this.cache) {
      if (now - entry.fetchedAt > this.ttlMs) {
        this.cache.delete(url);
      }
    }
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Stop the cleanup timer. Call on shutdown.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  /**
   * Get the number of cached entries (for diagnostics).
   */
  get size(): number {
    return this.cache.size;
  }
}
