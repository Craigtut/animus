/**
 * Task Runner
 *
 * Applies task lifecycle updates requested by heartbeat decisions.
 *
 * See docs/architecture/tasks-system.md
 */

import { getHeartbeatDb } from '../db/index.js';
import * as taskStore from '../db/stores/task-store.js';
import { now } from '@animus-labs/shared';

// ============================================================================
// Task Runner
// ============================================================================

export class TaskRunner {
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
   * Cancel a task.
   */
  cancelTask(taskId: string): void {
    const db = getHeartbeatDb();
    taskStore.updateTask(db, taskId, {
      status: 'cancelled',
      completedAt: now(),
    });
  }
}

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
