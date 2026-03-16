/**
 * Working directory tracking across Bash calls.
 *
 * Each Bash tool call spawns a new shell process. Shell state
 * (env vars, aliases) does NOT persist between calls. Only the
 * working directory persists via this tracker.
 *
 * The tracker is reset to the default directory at the start
 * of each agentic loop.
 */

import * as path from 'node:path';

export class CwdTracker {
  private readonly defaultDir: string;
  private currentDir: string;

  constructor(defaultDir: string) {
    this.defaultDir = path.resolve(defaultDir);
    this.currentDir = this.defaultDir;
  }

  /**
   * Get the current working directory.
   */
  getCwd(): string {
    return this.currentDir;
  }

  /**
   * Update the working directory. The path is resolved to absolute.
   */
  updateCwd(newDir: string): void {
    this.currentDir = path.resolve(newDir);
  }

  /**
   * Reset to the default directory. Called at the start of each agentic loop.
   */
  reset(): void {
    this.currentDir = this.defaultDir;
  }

  /**
   * Get the default (initial) directory.
   */
  getDefaultDir(): string {
    return this.defaultDir;
  }
}
