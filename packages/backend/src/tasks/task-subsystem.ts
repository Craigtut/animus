/**
 * Task Subsystem
 *
 * Wraps the task scheduler initialization into a SubsystemLifecycle. The
 * scheduler's task-due handler is provided via constructor callback so the
 * heartbeat can enqueue scheduled-task ticks.
 */

import type { SubsystemLifecycle } from '../lib/lifecycle.js';
import { createLogger } from '../lib/logger.js';
import { getHeartbeatDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import { getTaskScheduler } from './task-scheduler.js';

const log = createLogger('TaskSubsystem', 'heartbeat');

export class TaskSubsystem implements SubsystemLifecycle {
  readonly name = 'tasks';

  constructor(private onScheduledTask: (params: {
    taskId: string;
    taskTitle: string;
    taskType: string;
    taskInstructions: string;
    goalTitle?: string;
    planTitle?: string;
    currentMilestone?: string;
  }) => void) {}

  async start(): Promise<void> {
    const taskScheduler = getTaskScheduler();
    taskScheduler.setTaskDueHandler((task) => {
      const hbDb = getHeartbeatDb();
      const goal = task.goalId ? heartbeatStore.getGoal(hbDb, task.goalId) : null;
      const plan = task.planId ? heartbeatStore.getPlan(hbDb, task.planId) : null;
      const milestone = plan && task.milestoneIndex != null
        ? (plan.milestones as Array<{ title: string }>)?.[task.milestoneIndex]?.title
        : undefined;

      this.onScheduledTask({
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.scheduleType,
        taskInstructions: task.instructions || '',
        ...(goal ? { goalTitle: goal.title } : {}),
        ...(plan ? { planTitle: plan.strategy } : {}),
        ...(milestone ? { currentMilestone: milestone } : {}),
      });
    });
    taskScheduler.start();
    log.debug('Task scheduler started');
  }

  async stop(): Promise<void> {
    try {
      getTaskScheduler().stop();
    } catch (err) {
      log.warn('Failed to stop task scheduler:', err);
    }
  }
}
