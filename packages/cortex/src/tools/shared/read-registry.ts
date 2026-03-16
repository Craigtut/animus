/**
 * Session-scoped file read tracking.
 *
 * Shared by the Read, Write, and Edit tools to enforce
 * the read-before-write/edit contract. Tracks which files
 * have been read during the current agentic loop.
 *
 * Created once per CortexAgent and cleared at the start
 * of each agentic loop via clear().
 */

import * as path from 'node:path';

export class ReadRegistry {
  private readonly readPaths = new Set<string>();

  /**
   * Mark a file as read. The path is normalized to an
   * absolute, platform-canonical form before storing.
   */
  markRead(filePath: string): void {
    this.readPaths.add(this.normalize(filePath));
  }

  /**
   * Check whether a file has been read in the current session.
   */
  hasBeenRead(filePath: string): boolean {
    return this.readPaths.has(this.normalize(filePath));
  }

  /**
   * Clear all read tracking. Called at the start of each agentic loop.
   */
  clear(): void {
    this.readPaths.clear();
  }

  /**
   * Get the number of tracked files (for diagnostics).
   */
  get size(): number {
    return this.readPaths.size;
  }

  /**
   * Normalize a file path for consistent comparison.
   * Resolves to absolute and normalizes separators.
   */
  private normalize(filePath: string): string {
    return path.resolve(filePath);
  }
}
