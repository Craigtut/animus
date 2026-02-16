/**
 * Tasks Router — tRPC procedures for tasks and task runs.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getHeartbeatDb } from '../../db/index.js';
import * as taskStore from '../../db/stores/task-store.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { Task } from '@animus/shared';

export const tasksRouter = router({
  /**
   * Get tasks with optional filters.
   */
  getTasks: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              'pending',
              'scheduled',
              'in_progress',
              'completed',
              'failed',
              'cancelled',
              'paused',
            ])
            .optional(),
          scheduleType: z
            .enum(['one_shot', 'recurring', 'deferred'])
            .optional(),
          goalId: z.string().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      if (!input) return taskStore.listTasks(db);
      const filters: import('../../db/stores/task-store.js').ListTasksFilters = {};
      if (input.status !== undefined) filters.status = input.status;
      if (input.scheduleType !== undefined) filters.scheduleType = input.scheduleType;
      if (input.goalId !== undefined) filters.goalId = input.goalId;
      return taskStore.listTasks(db, filters);
    }),

  /**
   * Get a single task by ID.
   */
  getTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return taskStore.getTask(db, input.taskId);
    }),

  /**
   * Get top N deferred tasks.
   */
  getDeferredTasks: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(20).optional() }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return taskStore.getTopDeferredTasks(db, input?.limit ?? 5);
    }),

  /**
   * Get execution history (runs) for a task.
   */
  getTaskRuns: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return taskStore.getTaskRuns(db, input.taskId);
    }),

  /**
   * Create a new task.
   */
  createTask: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        instructions: z.string().optional(),
        scheduleType: z.enum(['one_shot', 'recurring', 'deferred']),
        cronExpression: z.string().optional(),
        scheduledAt: z.string().optional(),
        nextRunAt: z.string().optional(),
        goalId: z.string().optional(),
        planId: z.string().optional(),
        priority: z.number().min(0).max(1).optional(),
        contactId: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getHeartbeatDb();
      const data: import('../../db/stores/task-store.js').CreateTaskData = {
        title: input.title,
        scheduleType: input.scheduleType,
        createdBy: 'user',
        status: 'scheduled',
        ...(input.description !== undefined && { description: input.description }),
        ...(input.instructions !== undefined && { instructions: input.instructions }),
        ...(input.cronExpression !== undefined && { cronExpression: input.cronExpression }),
        ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
        ...(input.nextRunAt !== undefined && { nextRunAt: input.nextRunAt }),
        ...(input.goalId !== undefined && { goalId: input.goalId }),
        ...(input.planId !== undefined && { planId: input.planId }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.contactId !== undefined && { contactId: input.contactId }),
      };
      const task = taskStore.createTask(db, data);
      getEventBus().emit('task:created' as keyof import('@animus/shared').AnimusEventMap, task as never);
      return task;
    }),

  /**
   * Update an existing task.
   */
  updateTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        instructions: z.string().nullable().optional(),
        status: z
          .enum([
            'pending',
            'scheduled',
            'in_progress',
            'completed',
            'failed',
            'cancelled',
            'paused',
          ])
          .optional(),
        priority: z.number().min(0).max(1).optional(),
        cronExpression: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getHeartbeatDb();
      const { taskId, ...rest } = input;
      const data: import('../../db/stores/task-store.js').UpdateTaskData = {};
      if (rest.title !== undefined) data.title = rest.title;
      if (rest.description !== undefined) data.description = rest.description;
      if (rest.instructions !== undefined) data.instructions = rest.instructions;
      if (rest.status !== undefined) data.status = rest.status;
      if (rest.priority !== undefined) data.priority = rest.priority;
      if (rest.cronExpression !== undefined) data.cronExpression = rest.cronExpression;
      taskStore.updateTask(db, taskId, data);
      const updated = taskStore.getTask(db, taskId);
      if (updated) {
        getEventBus().emit('task:updated' as keyof import('@animus/shared').AnimusEventMap, updated as never);
      }
      return updated;
    }),

  /**
   * Subscribe to task changes (created or updated).
   */
  onTaskChange: protectedProcedure.subscription(() => {
    return observable<Task>((emit) => {
      const eventBus = getEventBus() as import('events').EventEmitter;
      const handler = (task: Task) => emit.next(task);
      eventBus.on('task:created', handler);
      eventBus.on('task:updated', handler);
      return () => {
        eventBus.off('task:created', handler);
        eventBus.off('task:updated', handler);
      };
    });
  }),
});
