/**
 * SubAgentManager: tracks active sub-agents, enforces concurrency limits,
 * manages lifecycle, and delivers background completion notifications.
 *
 * Each sub-agent is an independent CortexAgent instance tracked by task ID.
 * The manager does not own the CortexAgent; it tracks references and
 * coordinates lifecycle events for the consumer.
 *
 * References:
 *   - docs/cortex/tools/sub-agent.md
 *   - docs/cortex/plans/phase-4-sub-agents-and-skills.md
 */

import type { SubAgentResult, TrackedSubAgent } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubAgentManagerConfig {
  /** Maximum concurrent sub-agents. Default: 4. */
  maxConcurrent: number;
}

export interface SubAgentLifecycleHooks {
  onSpawned?: (taskId: string, instructions: string) => void;
  onCompleted?: (taskId: string, result: string, status: string, usage: unknown) => void;
  onFailed?: (taskId: string, error: string) => void;
}

// ---------------------------------------------------------------------------
// SubAgentManager
// ---------------------------------------------------------------------------

export class SubAgentManager {
  private readonly agents = new Map<string, TrackedSubAgent>();
  private readonly maxConcurrent: number;
  private hooks: SubAgentLifecycleHooks = {};

  constructor(config?: Partial<SubAgentManagerConfig>) {
    this.maxConcurrent = config?.maxConcurrent ?? 4;
  }

  /**
   * Set lifecycle hooks. Called by CortexAgent to wire consumer event handlers.
   */
  setHooks(hooks: SubAgentLifecycleHooks): void {
    this.hooks = hooks;
  }

  /**
   * Check if another sub-agent can be spawned within the concurrency limit.
   */
  canSpawn(): boolean {
    return this.agents.size < this.maxConcurrent;
  }

  /**
   * Get the number of currently active sub-agents.
   */
  get activeCount(): number {
    return this.agents.size;
  }

  /**
   * Get the concurrency limit.
   */
  get limit(): number {
    return this.maxConcurrent;
  }

  /**
   * Register a newly spawned sub-agent.
   * Returns false if the concurrency limit would be exceeded.
   */
  track(entry: TrackedSubAgent): boolean {
    if (this.agents.size >= this.maxConcurrent) {
      return false;
    }

    this.agents.set(entry.taskId, entry);

    // Fire lifecycle hook
    try {
      this.hooks.onSpawned?.(entry.taskId, entry.instructions);
    } catch {
      // Swallow hook errors
    }

    return true;
  }

  /**
   * Mark a sub-agent as completed and remove it from tracking.
   */
  complete(taskId: string, result: SubAgentResult): void {
    const entry = this.agents.get(taskId);
    if (!entry) return;

    this.agents.delete(taskId);

    // Resolve the completion promise
    entry.resolve(result);

    // Fire lifecycle hook
    try {
      this.hooks.onCompleted?.(
        taskId,
        result.output,
        result.status,
        result.usage,
      );
    } catch {
      // Swallow hook errors
    }
  }

  /**
   * Mark a sub-agent as failed and remove it from tracking.
   */
  fail(taskId: string, error: string): void {
    const entry = this.agents.get(taskId);
    if (!entry) return;

    this.agents.delete(taskId);

    // Resolve the completion promise with a failed result
    entry.resolve({
      output: '',
      status: 'failed',
      usage: { turns: 0, cost: 0, durationMs: Date.now() - entry.spawnedAt },
    });

    // Fire lifecycle hook
    try {
      this.hooks.onFailed?.(taskId, error);
    } catch {
      // Swallow hook errors
    }
  }

  /**
   * Get a tracked sub-agent by task ID.
   */
  get(taskId: string): TrackedSubAgent | undefined {
    return this.agents.get(taskId);
  }

  /**
   * Get all active sub-agent task IDs.
   */
  getActiveTaskIds(): string[] {
    return [...this.agents.keys()];
  }

  /**
   * Get completion promises for all background sub-agents.
   * Used to build follow-up messages when background agents complete.
   */
  getBackgroundCompletions(): Array<{ taskId: string; completion: Promise<SubAgentResult> }> {
    const results: Array<{ taskId: string; completion: Promise<SubAgentResult> }> = [];
    for (const [taskId, entry] of this.agents) {
      if (entry.background) {
        results.push({ taskId, completion: entry.completion });
      }
    }
    return results;
  }

  /**
   * Cancel all active sub-agents. Called during parent destroy().
   * Aborts each sub-agent and removes it from tracking.
   *
   * @param abortFn - Function to abort a CortexAgent (passed to avoid circular dep)
   */
  async cancelAll(abortFn: (agent: unknown) => Promise<void>): Promise<void> {
    const entries = [...this.agents.values()];
    this.agents.clear();

    const settled = await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await abortFn(entry.agent);
        } catch {
          // Best-effort abort
        }

        // Resolve the completion promise as cancelled
        entry.resolve({
          output: '',
          status: 'cancelled',
          usage: { turns: 0, cost: 0, durationMs: Date.now() - entry.spawnedAt },
        });

        // Fire failure hook
        try {
          this.hooks.onFailed?.(entry.taskId, 'Parent agent destroyed');
        } catch {
          // Swallow hook errors
        }
      }),
    );

    // Log any unexpected errors (consumer should provide logging)
    for (const result of settled) {
      if (result.status === 'rejected') {
        // Swallowed: best-effort cleanup
      }
    }
  }

  /**
   * Clean up all state. Called during parent destroy().
   */
  destroy(): void {
    this.agents.clear();
    this.hooks = {};
  }
}
