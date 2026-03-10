/**
 * Tasks Router — tRPC procedures for tasks and task runs.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getTaskService } from '../../services/task-service.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { Task } from '@animus-labs/shared';

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
      return getTaskService().listTasks(input ?? undefined);
    }),

  /**
   * Get a single task by ID.
   */
  getTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      return getTaskService().getTask(input.taskId);
    }),

  /**
   * Get top N deferred tasks.
   */
  getDeferredTasks: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(20).optional() }).optional()
    )
    .query(({ input }) => {
      return getTaskService().getDeferredTasks(input?.limit ?? 5);
    }),

  /**
   * Get execution history (runs) for a task.
   */
  getTaskRuns: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      return getTaskService().getTaskRuns(input.taskId);
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
      return getTaskService().createTask(input);
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
        scheduledAt: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const { taskId, ...data } = input;
      return getTaskService().updateTask(taskId, data);
    }),

  /**
   * Delete a task by ID.
   */
  deleteTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(({ input }) => {
      getTaskService().deleteTask(input.taskId);
      return { success: true };
    }),

  /**
   * Subscribe to task changes (created or updated).
   */
  onTaskChange: protectedProcedure.subscription(() => {
    return observable<Task>((emit) => {
      const eventBus = getEventBus();
      const handler = (task: Task) => emit.next(task);
      eventBus.on('task:created', handler);
      eventBus.on('task:updated', handler);
      return () => {
        eventBus.off('task:created', handler);
        eventBus.off('task:updated', handler);
      };
    });
  }),

  /**
   * Subscribe to task deletions.
   */
  onTaskDeleted: protectedProcedure.subscription(() => {
    return observable<{ taskId: string }>((emit) => {
      const eventBus = getEventBus();
      const handler = (payload: { taskId: string }) => emit.next(payload);
      eventBus.on('task:deleted', handler);
      return () => {
        eventBus.off('task:deleted', handler);
      };
    });
  }),
});
