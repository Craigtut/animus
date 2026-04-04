/**
 * Session-scoped file read tracking.
 *
 * Shared by the Read, Write, and Edit tools to enforce
 * the read-before-write/edit contract. Tracks which files
 * have been read during the current agentic loop, along with
 * metadata (mtime, offset, limit) for file-unchanged dedup.
 *
 * Created once per CortexAgent and cleared at the start
 * of each agentic loop via clear().
 */

import * as path from 'node:path';

export interface ReadState {
  /** File mtime at time of read (ms since epoch). */
  timestamp: number;
  /** 1-based offset used for the read (undefined = full read). */
  offset?: number;
  /** Line limit used for the read (undefined = default/full). */
  limit?: number;
}

export class ReadRegistry {
  private readonly entries = new Map<string, ReadState>();

  /**
   * Mark a file as read with metadata for dedup.
   * The path is normalized to an absolute, platform-canonical form.
   */
  markRead(filePath: string, state?: ReadState): void {
    this.entries.set(
      this.normalize(filePath),
      state ?? { timestamp: Date.now() },
    );
  }

  /**
   * Check whether a file has been read in the current session.
   */
  hasBeenRead(filePath: string): boolean {
    return this.entries.has(this.normalize(filePath));
  }

  /**
   * Get the read state for a file, or undefined if not read.
   */
  getState(filePath: string): ReadState | undefined {
    return this.entries.get(this.normalize(filePath));
  }

  /**
   * Clear all read tracking. Called at the start of each agentic loop.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get the number of tracked files (for diagnostics).
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Normalize a file path for consistent comparison.
   * Resolves to absolute and normalizes separators.
   */
  private normalize(filePath: string): string {
    return path.resolve(filePath);
  }
}
