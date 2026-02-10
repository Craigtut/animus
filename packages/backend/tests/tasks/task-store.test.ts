import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import * as taskStore from '../../src/db/stores/task-store.js';

describe('task-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  describe('createTask', () => {
    it('creates a one-shot task with defaults', () => {
      const task = taskStore.createTask(db, {
        title: 'Remind Craig',
        scheduleType: 'one_shot',
        createdBy: 'user',
      });
      expect(task.id).toBeDefined();
      expect(task.title).toBe('Remind Craig');
      expect(task.scheduleType).toBe('one_shot');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe(0.5);
      expect(task.retryCount).toBe(0);
      expect(task.createdBy).toBe('user');
    });

    it('creates a recurring task with cron', () => {
      const task = taskStore.createTask(db, {
        title: 'Daily check',
        scheduleType: 'recurring',
        cronExpression: '0 9 * * *',
        nextRunAt: '2026-02-09T09:00:00.000Z',
        status: 'scheduled',
        priority: 0.8,
        createdBy: 'mind',
        contactId: 'contact-123',
      });
      expect(task.cronExpression).toBe('0 9 * * *');
      expect(task.nextRunAt).toBe('2026-02-09T09:00:00.000Z');
      expect(task.status).toBe('scheduled');
      expect(task.priority).toBe(0.8);
      expect(task.contactId).toBe('contact-123');
    });

    it('creates a deferred task', () => {
      const task = taskStore.createTask(db, {
        title: 'Research gardening',
        scheduleType: 'deferred',
        status: 'scheduled',
        priority: 0.7,
        createdBy: 'mind',
      });
      expect(task.scheduleType).toBe('deferred');
      expect(task.nextRunAt).toBeNull();
    });
  });

  describe('getTask', () => {
    it('returns null for non-existent task', () => {
      expect(taskStore.getTask(db, 'nope')).toBeNull();
    });

    it('returns the created task', () => {
      const created = taskStore.createTask(db, {
        title: 'Test',
        scheduleType: 'one_shot',
        createdBy: 'user',
      });
      const found = taskStore.getTask(db, created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Test');
    });
  });

  describe('updateTask', () => {
    it('updates task status and result', () => {
      const task = taskStore.createTask(db, {
        title: 'Update me',
        scheduleType: 'one_shot',
        createdBy: 'user',
      });
      taskStore.updateTask(db, task.id, {
        status: 'completed',
        result: 'Done!',
      });
      const updated = taskStore.getTask(db, task.id)!;
      expect(updated.status).toBe('completed');
      expect(updated.result).toBe('Done!');
    });

    it('increments retry count', () => {
      const task = taskStore.createTask(db, {
        title: 'Retry me',
        scheduleType: 'one_shot',
        createdBy: 'user',
      });
      taskStore.updateTask(db, task.id, {
        retryCount: 1,
        lastError: 'timeout',
      });
      const updated = taskStore.getTask(db, task.id)!;
      expect(updated.retryCount).toBe(1);
      expect(updated.lastError).toBe('timeout');
    });
  });

  describe('listTasks', () => {
    it('lists all tasks', () => {
      taskStore.createTask(db, { title: 'A', scheduleType: 'one_shot', createdBy: 'user' });
      taskStore.createTask(db, { title: 'B', scheduleType: 'deferred', createdBy: 'mind' });
      const all = taskStore.listTasks(db);
      expect(all).toHaveLength(2);
    });

    it('filters by status', () => {
      taskStore.createTask(db, { title: 'A', scheduleType: 'one_shot', createdBy: 'user', status: 'scheduled' });
      taskStore.createTask(db, { title: 'B', scheduleType: 'one_shot', createdBy: 'user', status: 'completed' });
      const scheduled = taskStore.listTasks(db, { status: 'scheduled' });
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]!.title).toBe('A');
    });

    it('filters by schedule type', () => {
      taskStore.createTask(db, { title: 'A', scheduleType: 'one_shot', createdBy: 'user' });
      taskStore.createTask(db, { title: 'B', scheduleType: 'deferred', createdBy: 'mind' });
      const deferred = taskStore.listTasks(db, { scheduleType: 'deferred' });
      expect(deferred).toHaveLength(1);
      expect(deferred[0]!.title).toBe('B');
    });
  });

  describe('getDueTasks', () => {
    it('returns tasks due before the given time', () => {
      taskStore.createTask(db, {
        title: 'Past',
        scheduleType: 'one_shot',
        status: 'scheduled',
        nextRunAt: '2020-01-01T00:00:00.000Z',
        createdBy: 'user',
      });
      taskStore.createTask(db, {
        title: 'Future',
        scheduleType: 'one_shot',
        status: 'scheduled',
        nextRunAt: '2099-01-01T00:00:00.000Z',
        createdBy: 'user',
      });
      const due = taskStore.getDueTasks(db, new Date().toISOString());
      expect(due).toHaveLength(1);
      expect(due[0]!.title).toBe('Past');
    });

    it('ignores non-scheduled tasks', () => {
      taskStore.createTask(db, {
        title: 'In Progress',
        scheduleType: 'one_shot',
        status: 'in_progress',
        nextRunAt: '2020-01-01T00:00:00.000Z',
        createdBy: 'user',
      });
      const due = taskStore.getDueTasks(db, new Date().toISOString());
      expect(due).toHaveLength(0);
    });
  });

  describe('getNextDeferredTask', () => {
    it('returns highest priority deferred task', () => {
      taskStore.createTask(db, {
        title: 'Low',
        scheduleType: 'deferred',
        status: 'scheduled',
        priority: 0.3,
        createdBy: 'mind',
      });
      taskStore.createTask(db, {
        title: 'High',
        scheduleType: 'deferred',
        status: 'scheduled',
        priority: 0.9,
        createdBy: 'mind',
      });
      const next = taskStore.getNextDeferredTask(db);
      expect(next).not.toBeNull();
      expect(next!.title).toBe('High');
    });

    it('returns null when no deferred tasks exist', () => {
      expect(taskStore.getNextDeferredTask(db)).toBeNull();
    });
  });

  describe('getActiveScheduledTasks', () => {
    it('returns only scheduled one_shot and recurring tasks', () => {
      taskStore.createTask(db, {
        title: 'Scheduled',
        scheduleType: 'one_shot',
        status: 'scheduled',
        nextRunAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'user',
      });
      taskStore.createTask(db, {
        title: 'Deferred',
        scheduleType: 'deferred',
        status: 'scheduled',
        createdBy: 'mind',
      });
      taskStore.createTask(db, {
        title: 'Recurring',
        scheduleType: 'recurring',
        status: 'scheduled',
        nextRunAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'mind',
      });
      const active = taskStore.getActiveScheduledTasks(db);
      expect(active).toHaveLength(2);
      const titles = active.map((t) => t.title);
      expect(titles).toContain('Scheduled');
      expect(titles).toContain('Recurring');
    });
  });

  describe('cancelTasksByGoalId', () => {
    it('cancels pending and scheduled tasks for a goal', () => {
      // Create a real goal row so FK is satisfied
      const goalId = 'goal-test-1';
      db.prepare(
        `INSERT INTO goals (id, title, origin, status, base_priority, current_salience)
         VALUES (?, 'Test Goal', 'user_request', 'active', 0.5, 0.5)`
      ).run(goalId);

      taskStore.createTask(db, {
        title: 'A',
        scheduleType: 'one_shot',
        status: 'scheduled',
        goalId,
        createdBy: 'mind',
      });
      taskStore.createTask(db, {
        title: 'B',
        scheduleType: 'one_shot',
        status: 'in_progress',
        goalId,
        createdBy: 'mind',
      });
      const cancelled = taskStore.cancelTasksByGoalId(db, goalId);
      expect(cancelled).toBe(1); // Only the 'scheduled' one
    });
  });

  describe('task runs', () => {
    it('creates and retrieves task runs', () => {
      const task = taskStore.createTask(db, {
        title: 'Recurring',
        scheduleType: 'recurring',
        createdBy: 'mind',
      });
      const run = taskStore.createTaskRun(db, {
        taskId: task.id,
        status: 'completed',
      });
      expect(run.id).toBeDefined();
      expect(run.taskId).toBe(task.id);

      const runs = taskStore.getTaskRuns(db, task.id);
      expect(runs).toHaveLength(1);
    });

    it('updates task run with result', () => {
      const task = taskStore.createTask(db, {
        title: 'Test',
        scheduleType: 'recurring',
        createdBy: 'mind',
      });
      const run = taskStore.createTaskRun(db, { taskId: task.id });
      taskStore.updateTaskRun(db, run.id, {
        result: 'Success',
        completedAt: new Date().toISOString(),
      });
      const runs = taskStore.getTaskRuns(db, task.id);
      expect(runs[0]!.result).toBe('Success');
    });

    it('counts consecutive failures', () => {
      const task = taskStore.createTask(db, {
        title: 'Failing',
        scheduleType: 'recurring',
        createdBy: 'mind',
      });

      // Create 3 failed runs with distinct timestamps so ordering is deterministic
      for (let i = 0; i < 3; i++) {
        const run = taskStore.createTaskRun(db, { taskId: task.id, status: 'failed' });
        const ts = new Date(Date.now() + i * 1000).toISOString();
        db.prepare('UPDATE task_runs SET started_at = ? WHERE id = ?').run(ts, run.id);
        taskStore.updateTaskRun(db, run.id, { error: `Error ${i}` });
      }

      expect(taskStore.getConsecutiveFailureCount(db, task.id)).toBe(3);

      // Add a success with a later timestamp
      const successRun = taskStore.createTaskRun(db, { taskId: task.id, status: 'completed' });
      const latestTs = new Date(Date.now() + 10_000).toISOString();
      db.prepare('UPDATE task_runs SET started_at = ? WHERE id = ?').run(latestTs, successRun.id);
      expect(taskStore.getConsecutiveFailureCount(db, task.id)).toBe(0);
    });
  });
});
