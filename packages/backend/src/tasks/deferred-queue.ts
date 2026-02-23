/**
 * Deferred Task Queue
 *
 * Manages deferred tasks that execute during idle heartbeat ticks.
 * Deferred tasks surface when no other triggers fire and the mind
 * decides to pick one up.
 *
 * See docs/architecture/tasks-system.md — "Deferred Tasks"
 */

import { getHeartbeatDb } from '../db/index.js';
import * as taskStore from '../db/stores/task-store.js';
import { now } from '@animus-labs/shared';
import type { Task } from '@animus-labs/shared';

// ============================================================================
// Constants (from docs/architecture/tasks-system.md)
// ============================================================================

/** Max deferred tasks shown to the mind during idle ticks */
export const MAX_DEFERRED_TASKS_IN_CONTEXT = 5;

/** Days before deferred task priority starts boosting */
export const DEFERRED_STALENESS_BOOST_DAYS = 7;

/** Priority boost per day after staleness threshold */
export const DEFERRED_STALENESS_BOOST_RATE = 0.02;

/** Days before deferred task is auto-cancelled */
export const DEFERRED_AUTO_CANCEL_DAYS = 30;

// ============================================================================
// Deferred Queue
// ============================================================================

export class DeferredQueue {
  /**
   * Enqueue a deferred task.
   */
  enqueue(data: {
    title: string;
    description?: string | null;
    instructions?: string | null;
    priority?: number;
    goalId?: string | null;
    planId?: string | null;
    contactId?: string | null;
    createdBy?: 'mind' | 'planning_agent' | 'user';
  }): Task {
    const db = getHeartbeatDb();
    return taskStore.createTask(db, {
      title: data.title,
      ...(data.description !== undefined && { description: data.description }),
      ...(data.instructions !== undefined && { instructions: data.instructions }),
      scheduleType: 'deferred',
      priority: data.priority ?? 0.5,
      status: 'scheduled',
      ...(data.goalId !== undefined && { goalId: data.goalId }),
      ...(data.planId !== undefined && { planId: data.planId }),
      ...(data.contactId !== undefined && { contactId: data.contactId }),
      createdBy: data.createdBy ?? 'mind',
    });
  }

  /**
   * Get the next deferred task to execute (highest priority).
   */
  getNext(): Task | null {
    const db = getHeartbeatDb();
    return taskStore.getNextDeferredTask(db);
  }

  /**
   * Get top N deferred tasks for mind context.
   */
  getTopTasks(limit: number = MAX_DEFERRED_TASKS_IN_CONTEXT): Task[] {
    const db = getHeartbeatDb();
    return taskStore.getTopDeferredTasks(db, limit);
  }

  /**
   * Apply staleness processing to deferred tasks:
   * - Boost priority for tasks older than DEFERRED_STALENESS_BOOST_DAYS
   * - Auto-cancel tasks older than DEFERRED_AUTO_CANCEL_DAYS
   */
  processStaleness(): { boosted: number; cancelled: number } {
    const db = getHeartbeatDb();
    const deferredTasks = taskStore.listTasks(db, {
      scheduleType: 'deferred',
      status: 'scheduled',
    });

    const currentTime = Date.now();
    let boosted = 0;
    let cancelled = 0;

    for (const task of deferredTasks) {
      const createdAt = new Date(task.createdAt).getTime();
      const ageDays = (currentTime - createdAt) / (1000 * 60 * 60 * 24);

      if (ageDays >= DEFERRED_AUTO_CANCEL_DAYS) {
        // Auto-cancel
        taskStore.updateTask(db, task.id, {
          status: 'cancelled',
          completedAt: now(),
          lastError: `Auto-cancelled after ${DEFERRED_AUTO_CANCEL_DAYS} days pending`,
        });
        cancelled++;
      } else if (ageDays >= DEFERRED_STALENESS_BOOST_DAYS) {
        // Boost priority
        const daysOverThreshold = ageDays - DEFERRED_STALENESS_BOOST_DAYS;
        const boost = daysOverThreshold * DEFERRED_STALENESS_BOOST_RATE;
        const newPriority = Math.min(1, task.priority + boost);
        if (newPriority !== task.priority) {
          taskStore.updateTask(db, task.id, { priority: newPriority });
          boosted++;
        }
      }
    }

    return { boosted, cancelled };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let queue: DeferredQueue | null = null;

export function getDeferredQueue(): DeferredQueue {
  if (!queue) {
    queue = new DeferredQueue();
  }
  return queue;
}
