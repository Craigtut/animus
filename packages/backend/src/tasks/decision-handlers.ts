/**
 * Task Decision Handlers
 *
 * Registers handlers for task-related decisions:
 * schedule_task, start_task, complete_task, cancel_task, skip_task.
 *
 * Extracted from decision-executor.ts executeGoalTaskDecisions().
 */

import { registerDecisionHandler, type DecisionHandlerContext } from '../heartbeat/decision-registry.js';
import * as taskStore from '../db/stores/task-store.js';
import { now } from '@animus-labs/shared';
import type { ScheduleType } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('TaskDecisions', 'heartbeat');

function resolveTaskIdOrThrow(taskId: string, decisionType: string, ctx: DecisionHandlerContext): string {
  const resolved = taskStore.resolveTaskId(ctx.hbDb, taskId);
  if (!resolved) {
    const message = `${decisionType} failed: task "${taskId}" was not found or was ambiguous`;
    log.warn(message);
    throw new Error(message);
  }
  return resolved;
}

// schedule_task
registerDecisionHandler('schedule_task', async (params, decision, ctx) => {
  const scheduleType = (params['scheduleType'] as ScheduleType) ?? 'deferred';

  // Compute nextRunAt if not explicitly provided
  let nextRunAt: string | undefined = params['nextRunAt'] ? String(params['nextRunAt']) : undefined;
  const cronExpr = params['cronExpression'] ? String(params['cronExpression']) : undefined;
  const scheduledAt = params['scheduledAt'] ? String(params['scheduledAt']) : undefined;

  if (!nextRunAt) {
    if (scheduleType === 'recurring' && cronExpr) {
      const { computeNextRunAt } = await import('../tasks/task-scheduler.js');
      nextRunAt = computeNextRunAt(cronExpr) ?? undefined;
      if (!nextRunAt) {
        log.warn(`Invalid cron expression "${cronExpr}" for schedule_task decision -- task will not fire`);
      }
    } else if (scheduleType === 'one_shot' && scheduledAt) {
      nextRunAt = scheduledAt;
    }
  }

  const task = taskStore.createTask(ctx.hbDb, {
    title: String(params['title'] ?? decision.description),
    ...(params['description'] ? { description: String(params['description']) } : {}),
    ...(params['instructions'] ? { instructions: String(params['instructions']) } : {}),
    scheduleType,
    ...(cronExpr ? { cronExpression: cronExpr } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(params['goalId'] ? { goalId: String(params['goalId']) } : {}),
    ...(params['planId'] ? { planId: String(params['planId']) } : {}),
    ...(typeof params['priority'] === 'number' ? { priority: params['priority'] } : {}),
    createdBy: 'mind',
    ...(params['contactId'] ? { contactId: String(params['contactId']) } : {}),
    status: 'scheduled',
  });
  ctx.eventBus.emit('task:created', task);

  // Register with scheduler if it's a timed task
  if (scheduleType !== 'deferred') {
    try {
      ctx.taskScheduler.registerTask(task);
    } catch (err) {
      log.warn(`Failed to register task ${task.id} with scheduler:`, err);
    }
  }
});

// start_task
registerDecisionHandler('start_task', async (params, _decision, ctx) => {
  const taskId = resolveTaskIdOrThrow(String(params['taskId'] ?? ''), 'start_task', ctx);
  taskStore.updateTask(ctx.hbDb, taskId, {
    status: 'in_progress',
    startedAt: now(),
  });
  const journal = taskStore.updateTaskJournalStatus(ctx.hbDb, taskId, 'in_progress', ctx.tickNumber);
  if (journal) ctx.eventBus.emit('task:journal_updated', journal);
  const updated = taskStore.getTask(ctx.hbDb, taskId);
  if (updated) ctx.eventBus.emit('task:updated', updated);
});

// complete_task
registerDecisionHandler('complete_task', async (params, _decision, ctx) => {
  const taskId = resolveTaskIdOrThrow(String(params['taskId'] ?? ''), 'complete_task', ctx);
  const result = params['result'] ? String(params['result']) : undefined;
  ctx.taskRunner.completeTask(taskId, result);
  const journal = taskStore.updateTaskJournalStatus(ctx.hbDb, taskId, 'complete', ctx.tickNumber);
  if (journal) ctx.eventBus.emit('task:journal_updated', journal);
  const updated = taskStore.getTask(ctx.hbDb, taskId);
  if (updated) ctx.eventBus.emit('task:updated', updated);
});

// cancel_task
registerDecisionHandler('cancel_task', async (params, _decision, ctx) => {
  const taskId = resolveTaskIdOrThrow(String(params['taskId'] ?? ''), 'cancel_task', ctx);
  ctx.taskRunner.cancelTask(taskId);
  try {
    ctx.taskScheduler.unregisterTask(taskId);
  } catch {
    // Scheduler may not be running
  }
  const updated = taskStore.getTask(ctx.hbDb, taskId);
  if (updated) ctx.eventBus.emit('task:updated', updated);
});

// skip_task
registerDecisionHandler('skip_task', async (params, _decision, ctx) => {
  const taskId = resolveTaskIdOrThrow(String(params['taskId'] ?? ''), 'skip_task', ctx);
  const task = taskStore.getTask(ctx.hbDb, taskId);
  if (!task) return;

  if (task.scheduleType === 'recurring' && task.cronExpression) {
    // Advance to next run time
    const { computeNextRunAt } = await import('../tasks/task-scheduler.js');
    const nextRunAt = computeNextRunAt(task.cronExpression);
    if (nextRunAt) {
      taskStore.updateTask(ctx.hbDb, taskId, { nextRunAt });
    }
  } else {
    // One-shot or deferred: mark as completed with skip note
    taskStore.updateTask(ctx.hbDb, taskId, {
      status: 'completed',
      result: 'Skipped by mind decision',
      completedAt: now(),
    });
  }
  const updated = taskStore.getTask(ctx.hbDb, taskId);
  if (updated) ctx.eventBus.emit('task:updated', updated);
});
