/**
 * Task Scheduler
 *
 * Manages scheduled and recurring tasks with precise timing.
 * Runs independently of the heartbeat interval timer.
 * When a task is due, fires a scheduled_task tick trigger.
 *
 * See docs/architecture/tasks-system.md
 */

import { CronExpressionParser } from 'cron-parser';
import { getHeartbeatDb, getSystemDb } from '../db/index.js';
import * as taskStore from '../db/stores/task-store.js';
import * as systemStore from '../db/stores/system-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { now } from '@animus/shared';
import type { Task } from '@animus/shared';

const log = createLogger('TaskScheduler', 'heartbeat');

// ============================================================================
// Constants
// ============================================================================

/** How often the scheduler checks for due tasks (ms) */
const CHECK_INTERVAL_MS = 30_000;

// ============================================================================
// Task Scheduler
// ============================================================================

export class TaskScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onTaskDue: ((task: Task) => void) | null = null;

  /**
   * Set the callback that fires when a task is due.
   * The heartbeat system uses this to create a scheduled_task tick.
   */
  setTaskDueHandler(handler: (task: Task) => void): void {
    this.onTaskDue = handler;
  }

  /**
   * Start the task scheduler.
   * Loads all active scheduled tasks and sets timers.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Load and process active tasks
    this.loadTasks();

    // Start periodic check interval
    this.checkInterval = setInterval(() => {
      this.checkDueTasks();
    }, CHECK_INTERVAL_MS);

    log.info('Started');
  }

  /**
   * Stop the task scheduler. Clears all timers.
   */
  stop(): void {
    this.running = false;

    // Clear check interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all task timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    log.info('Stopped');
  }

  /**
   * Register a single task with the scheduler.
   * Sets a timer if the task has a next_run_at in the future.
   */
  registerTask(task: Task): void {
    if (!this.running) return;

    // Clear existing timer for this task
    this.clearTaskTimer(task.id);

    if (task.status !== 'scheduled') return;
    if (!task.nextRunAt) return;

    const nextRun = new Date(task.nextRunAt).getTime();
    const delay = nextRun - Date.now();

    if (delay <= 0) {
      // Task is overdue — fire immediately
      this.fireTask(task);
    } else {
      // Set timer for future execution
      const timer = setTimeout(() => {
        this.timers.delete(task.id);
        this.fireTask(task);
      }, delay);
      this.timers.set(task.id, timer);
    }
  }

  /**
   * Remove a task from the scheduler.
   */
  unregisterTask(taskId: string): void {
    this.clearTaskTimer(taskId);
  }

  /**
   * Check if the scheduler is running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get count of registered task timers.
   */
  get registeredCount(): number {
    return this.timers.size;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private loadTasks(): void {
    try {
      const db = getHeartbeatDb();
      const tasks = taskStore.getActiveScheduledTasks(db);

      for (const task of tasks) {
        if (!task.nextRunAt) continue;

        const nextRun = new Date(task.nextRunAt).getTime();
        if (nextRun <= Date.now()) {
          // Missed while server was down — fire once (catch-up)
          this.fireTask(task);
        } else {
          this.registerTask(task);
        }
      }

      log.info(`Loaded ${tasks.length} active tasks`);
    } catch (err) {
      log.error('Failed to load tasks:', err);
    }
  }

  private checkDueTasks(): void {
    if (!this.running) return;

    try {
      const db = getHeartbeatDb();
      const dueTasks = taskStore.getDueTasks(db, now());

      for (const task of dueTasks) {
        // Only fire if not already tracked by a timer
        if (!this.timers.has(task.id)) {
          this.fireTask(task);
        }
      }
    } catch (err) {
      log.error('Error checking due tasks:', err);
    }
  }

  private fireTask(task: Task): void {
    const db = getHeartbeatDb();

    // Update task status to in_progress
    taskStore.updateTask(db, task.id, {
      status: 'in_progress',
      startedAt: now(),
    });

    // For recurring tasks, compute next_run_at and schedule a new instance
    if (task.scheduleType === 'recurring' && task.cronExpression) {
      const nextRunAt = computeNextRunAt(task.cronExpression);
      if (nextRunAt) {
        // Reset status back to scheduled with the new next_run_at
        // so the periodic check picks it up for the next execution
        taskStore.updateTask(db, task.id, {
          status: 'scheduled',
          nextRunAt,
          startedAt: null,
        });
        // Re-register the timer for next execution
        const updatedTask = taskStore.getTask(db, task.id);
        if (updatedTask) {
          this.registerTask(updatedTask);
        }
      }
    }

    // Notify the heartbeat system
    if (this.onTaskDue) {
      this.onTaskDue(task);
    }

    getEventBus().emit('heartbeat:tick_start', {
      tickNumber: -1, // Will be assigned by the tick queue
      triggerType: 'scheduled_task',
    });
  }

  private clearTaskTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }
}

// ============================================================================
// Cron Helpers
// ============================================================================

/**
 * Compute the next run time from a cron expression.
 * Returns null if the expression is invalid.
 */
export function computeNextRunAt(
  cronExpression: string,
  timezone?: string
): string | null {
  try {
    const tz = timezone ?? getTimezone();
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz,
    });
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

/**
 * Validate a cron expression and return the next 3 fire times.
 * Returns null if invalid.
 */
export function validateCronExpression(
  cronExpression: string,
  timezone?: string
): { valid: true; nextRuns: string[] } | { valid: false; error: string } {
  try {
    if (!cronExpression || !cronExpression.trim()) {
      return { valid: false, error: 'Cron expression cannot be empty' };
    }
    const tz = timezone ?? getTimezone();
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz,
    });
    const nextRuns: string[] = [];
    for (let i = 0; i < 3; i++) {
      nextRuns.push(interval.next().toISOString());
    }
    return { valid: true, nextRuns };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getTimezone(): string {
  try {
    const db = getSystemDb();
    const settings = systemStore.getSystemSettings(db);
    return (settings as Record<string, unknown>).timezone as string ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let scheduler: TaskScheduler | null = null;

export function getTaskScheduler(): TaskScheduler {
  if (!scheduler) {
    scheduler = new TaskScheduler();
  }
  return scheduler;
}
