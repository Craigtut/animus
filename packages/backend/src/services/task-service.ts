/**
 * Task Service — business logic for task management.
 *
 * Encapsulates task CRUD, status transitions, scheduler registration,
 * and side effects (event bus, runner cancellation).
 * The router layer handles auth and input validation; this layer owns the logic.
 */

import { TRPCError } from '@trpc/server';
import { createLogger } from '../lib/logger.js';
import { getHeartbeatDb } from '../db/index.js';
import * as taskStore from '../db/stores/task-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { getTaskScheduler, getTaskRunner } from '../tasks/index.js';
import type {
  Task,
  TaskRun,
  TaskStatus,
  ScheduleType,
} from '@animus/shared';

const log = createLogger('TaskService', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface CreateTaskInput {
  title: string;
  description?: string | undefined;
  instructions?: string | undefined;
  scheduleType: ScheduleType;
  cronExpression?: string | undefined;
  scheduledAt?: string | undefined;
  nextRunAt?: string | undefined;
  goalId?: string | undefined;
  planId?: string | undefined;
  priority?: number | undefined;
  contactId?: string | undefined;
}

export interface UpdateTaskInput {
  title?: string | undefined;
  description?: string | null | undefined;
  instructions?: string | null | undefined;
  status?: TaskStatus | undefined;
  priority?: number | undefined;
  cronExpression?: string | null | undefined;
  scheduledAt?: string | null | undefined;
}

export interface TaskFilters {
  status?: TaskStatus | undefined;
  scheduleType?: ScheduleType | undefined;
  goalId?: string | undefined;
}

// ============================================================================
// Service
// ============================================================================

class TaskService {
  /**
   * List tasks with optional filters.
   */
  listTasks(filters?: TaskFilters): Task[] {
    const db = getHeartbeatDb();
    if (!filters) return taskStore.listTasks(db);

    const storeFilters: taskStore.ListTasksFilters = {};
    if (filters.status !== undefined) storeFilters.status = filters.status;
    if (filters.scheduleType !== undefined) storeFilters.scheduleType = filters.scheduleType;
    if (filters.goalId !== undefined) storeFilters.goalId = filters.goalId;
    return taskStore.listTasks(db, storeFilters);
  }

  /**
   * Get a single task by ID.
   */
  getTask(id: string): Task | null {
    return taskStore.getTask(getHeartbeatDb(), id);
  }

  /**
   * Get top N deferred tasks for context display.
   */
  getDeferredTasks(limit: number = 5): Task[] {
    return taskStore.getTopDeferredTasks(getHeartbeatDb(), limit);
  }

  /**
   * Get execution history (runs) for a task.
   */
  getTaskRuns(taskId: string): TaskRun[] {
    return taskStore.getTaskRuns(getHeartbeatDb(), taskId);
  }

  /**
   * Create a new task and emit a created event.
   */
  createTask(data: CreateTaskInput): Task {
    const db = getHeartbeatDb();
    const taskData: taskStore.CreateTaskData = {
      title: data.title,
      scheduleType: data.scheduleType,
      createdBy: 'user',
      status: 'scheduled',
      ...(data.description !== undefined && { description: data.description }),
      ...(data.instructions !== undefined && { instructions: data.instructions }),
      ...(data.cronExpression !== undefined && { cronExpression: data.cronExpression }),
      ...(data.scheduledAt !== undefined && { scheduledAt: data.scheduledAt }),
      ...(data.nextRunAt !== undefined && { nextRunAt: data.nextRunAt }),
      ...(data.goalId !== undefined && { goalId: data.goalId }),
      ...(data.planId !== undefined && { planId: data.planId }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.contactId !== undefined && { contactId: data.contactId }),
    };

    const task = taskStore.createTask(db, taskData);
    getEventBus().emit('task:created', task);
    log.info(`Created task "${task.title}" (${task.id})`);
    return task;
  }

  /**
   * Update an existing task. Re-registers with scheduler if schedule changed.
   */
  updateTask(id: string, data: UpdateTaskInput): Task | null {
    const db = getHeartbeatDb();
    const { ...rest } = data;
    const cronChanged = rest.cronExpression !== undefined;
    const scheduledAtChanged = rest.scheduledAt !== undefined;

    const updateData: taskStore.UpdateTaskData = {};
    if (rest.title !== undefined) updateData.title = rest.title;
    if (rest.description !== undefined) updateData.description = rest.description;
    if (rest.instructions !== undefined) updateData.instructions = rest.instructions;
    if (rest.status !== undefined) updateData.status = rest.status;
    if (rest.priority !== undefined) updateData.priority = rest.priority;
    if (rest.cronExpression !== undefined) updateData.cronExpression = rest.cronExpression;
    if (rest.scheduledAt !== undefined) {
      updateData.scheduledAt = rest.scheduledAt;
      updateData.nextRunAt = rest.scheduledAt;
    }

    taskStore.updateTask(db, id, updateData);
    const updated = taskStore.getTask(db, id);

    if (updated) {
      // Re-register with scheduler if schedule changed
      if (cronChanged || scheduledAtChanged) {
        const scheduler = getTaskScheduler();
        scheduler.unregisterTask(id);
        if (updated.status === 'scheduled' && (updated.scheduleType === 'recurring' || updated.scheduleType === 'one_shot')) {
          scheduler.registerTask(updated);
        }
      }
      getEventBus().emit('task:updated', updated);
    }

    return updated;
  }

  /**
   * Delete a task. Cancels if in progress, unregisters from scheduler.
   */
  deleteTask(id: string): void {
    const db = getHeartbeatDb();
    const task = taskStore.getTask(db, id);
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    // Cancel if in progress
    if (task.status === 'in_progress') {
      getTaskRunner().cancelTask(id);
    }

    // Unregister from scheduler (clears timer)
    getTaskScheduler().unregisterTask(id);

    // Delete from DB (CASCADE handles task_runs)
    taskStore.deleteTask(db, id);

    getEventBus().emit('task:deleted', { taskId: id });
    log.info(`Deleted task "${task.title}" (${id})`);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: TaskService | null = null;

export function getTaskService(): TaskService {
  if (!instance) instance = new TaskService();
  return instance;
}
