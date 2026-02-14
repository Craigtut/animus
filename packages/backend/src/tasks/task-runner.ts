/**
 * Task Runner
 *
 * Executes tasks with lifecycle tracking.
 * Handles concurrency control, timeouts, and retry logic.
 *
 * See docs/architecture/tasks-system.md
 */

import { getHeartbeatDb } from '../db/index.js';
import * as taskStore from '../db/stores/task-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { now } from '@animus/shared';
import type { Task, TaskStatus } from '@animus/shared';

const log = createLogger('TaskRunner', 'heartbeat');

// ============================================================================
// Constants
// ============================================================================

/** Maximum concurrent task executions */
const DEFAULT_CONCURRENCY = 3;

/** Default timeout per task (ms) — 5 minutes */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum retries per task */
const MAX_TASK_RETRIES = 3;

/** Maximum consecutive failures before pausing a recurring task */
const MAX_CONSECUTIVE_FAILURES = 5;

/** Delay before retrying a failed one-shot task (ms) — 5 minutes */
const RETRY_DELAY_MS = 5 * 60 * 1000;

// ============================================================================
// Task Runner
// ============================================================================

export class TaskRunner {
  private activeCount = 0;
  private concurrency: number;
  private timeoutMs: number;

  constructor(options?: { concurrency?: number; timeoutMs?: number }) {
    this.concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Check if the runner can accept more tasks.
   */
  get canAcceptTask(): boolean {
    return this.activeCount < this.concurrency;
  }

  /**
   * Get current active task count.
   */
  get activeTaskCount(): number {
    return this.activeCount;
  }

  /**
   * Execute a task. Updates lifecycle status in the database.
   *
   * Returns the final task status after execution.
   */
  async executeTask(
    taskId: string,
    executor: (task: Task) => Promise<{ result?: string; error?: string }>
  ): Promise<TaskStatus> {
    const db = getHeartbeatDb();
    const task = taskStore.getTask(db, taskId);

    if (!task) {
      log.error(`Task not found: ${taskId}`);
      return 'failed';
    }

    // Mark as in_progress
    taskStore.updateTask(db, taskId, {
      status: 'in_progress',
      startedAt: now(),
    });

    this.activeCount++;

    try {
      // Execute with timeout
      const outcome = await Promise.race([
        executor(task),
        this.createTimeout(taskId),
      ]);

      if (outcome.error) {
        return this.handleFailure(task, outcome.error);
      }

      return this.handleSuccess(task, outcome.result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return this.handleFailure(task, errorMsg);
    } finally {
      this.activeCount--;
    }
  }

  /**
   * Mark a task as completed directly (used when the mind handles inline).
   */
  completeTask(taskId: string, result?: string): void {
    const db = getHeartbeatDb();
    const task = taskStore.getTask(db, taskId);
    if (!task) return;

    if (task.scheduleType === 'recurring') {
      // Log the run, task stays scheduled
      const run = taskStore.createTaskRun(db, { taskId, status: 'completed' });
      taskStore.updateTaskRun(db, run.id, {
        result: result ?? null,
        completedAt: now(),
      });
      // Status stays 'scheduled' for recurring; next_run_at already set by scheduler
      taskStore.updateTask(db, taskId, { status: 'scheduled' });
    } else {
      taskStore.updateTask(db, taskId, {
        status: 'completed',
        result: result ?? null,
        completedAt: now(),
      });
    }
  }

  /**
   * Mark a task as failed directly.
   */
  failTask(taskId: string, error: string): void {
    const db = getHeartbeatDb();
    const task = taskStore.getTask(db, taskId);
    if (!task) return;
    this.handleFailure(task, error);
  }

  /**
   * Cancel a task.
   */
  cancelTask(taskId: string): void {
    const db = getHeartbeatDb();
    taskStore.updateTask(db, taskId, {
      status: 'cancelled',
      completedAt: now(),
    });
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private handleSuccess(task: Task, result?: string): TaskStatus {
    const db = getHeartbeatDb();

    if (task.scheduleType === 'recurring') {
      // Log the run
      const run = taskStore.createTaskRun(db, {
        taskId: task.id,
        status: 'completed',
      });
      taskStore.updateTaskRun(db, run.id, {
        result: result ?? null,
        completedAt: now(),
      });
      // Task stays scheduled for next run
      taskStore.updateTask(db, task.id, { status: 'scheduled' });
      return 'scheduled';
    }

    // One-shot or deferred: mark completed
    taskStore.updateTask(db, task.id, {
      status: 'completed',
      result: result ?? null,
      completedAt: now(),
    });
    return 'completed';
  }

  private handleFailure(task: Task, error: string): TaskStatus {
    const db = getHeartbeatDb();

    if (task.scheduleType === 'recurring') {
      // Log the failed run
      const run = taskStore.createTaskRun(db, {
        taskId: task.id,
        status: 'failed',
      });
      taskStore.updateTaskRun(db, run.id, {
        error,
        completedAt: now(),
      });

      // Check consecutive failure count
      const consecutiveFailures = taskStore.getConsecutiveFailureCount(
        db,
        task.id
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Pause the task
        taskStore.updateTask(db, task.id, {
          status: 'paused',
          lastError: `Paused after ${consecutiveFailures} consecutive failures: ${error}`,
        });
        return 'paused';
      }

      // Task stays scheduled for next run
      taskStore.updateTask(db, task.id, {
        status: 'scheduled',
        lastError: error,
      });
      return 'scheduled';
    }

    // One-shot or deferred: check retry count
    const newRetryCount = (task.retryCount ?? 0) + 1;
    if (newRetryCount < MAX_TASK_RETRIES) {
      // Schedule retry
      if (task.scheduleType === 'one_shot') {
        const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
        taskStore.updateTask(db, task.id, {
          status: 'scheduled',
          retryCount: newRetryCount,
          lastError: error,
          nextRunAt: retryAt,
        });
        return 'scheduled';
      }
      // Deferred: leave as scheduled for next idle pickup
      taskStore.updateTask(db, task.id, {
        status: 'scheduled',
        retryCount: newRetryCount,
        lastError: error,
      });
      return 'scheduled';
    }

    // All retries exhausted
    taskStore.updateTask(db, task.id, {
      status: 'failed',
      retryCount: newRetryCount,
      lastError: error,
      completedAt: now(),
    });
    return 'failed';
  }

  private createTimeout(
    taskId: string
  ): Promise<{ result?: string; error: string }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ error: `Task ${taskId} timed out after ${this.timeoutMs}ms` });
      }, this.timeoutMs);
    });
  }
}

// ============================================================================
// Exported Constants
// ============================================================================

export { MAX_TASK_RETRIES, MAX_CONSECUTIVE_FAILURES };

// ============================================================================
// Singleton
// ============================================================================

let runner: TaskRunner | null = null;

export function getTaskRunner(): TaskRunner {
  if (!runner) {
    runner = new TaskRunner();
  }
  return runner;
}
