/**
 * Task System — barrel export
 *
 * Provides task scheduling, execution, and deferred queue management.
 * See docs/architecture/tasks-system.md
 */

export { TaskScheduler, getTaskScheduler, computeNextRunAt, validateCronExpression } from './task-scheduler.js';
export { TaskRunner, getTaskRunner, MAX_TASK_RETRIES, MAX_CONSECUTIVE_FAILURES } from './task-runner.js';
export {
  DeferredQueue,
  getDeferredQueue,
  MAX_DEFERRED_TASKS_IN_CONTEXT,
  DEFERRED_STALENESS_BOOST_DAYS,
  DEFERRED_STALENESS_BOOST_RATE,
  DEFERRED_AUTO_CANCEL_DAYS,
} from './deferred-queue.js';
