import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import * as taskStore from '../../src/db/stores/task-store.js';

// We need to mock getHeartbeatDb before importing TaskRunner
vi.mock('../../src/db/index.js', () => {
  let mockDb: Database.Database;
  return {
    getHeartbeatDb: () => mockDb,
    getSystemDb: vi.fn(),
    getMessagesDb: vi.fn(),
    _setMockDb: (db: Database.Database) => { mockDb = db; },
  };
});

// Import after mocking
const { TaskRunner } = await import('../../src/tasks/task-runner.js');
const dbModule = await import('../../src/db/index.js') as unknown as { _setMockDb: (db: Database.Database) => void };

describe('task-runner', () => {
  let db: Database.Database;
  let runner: InstanceType<typeof TaskRunner>;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    (dbModule as { _setMockDb: (db: Database.Database) => void })._setMockDb(db);
    runner = new TaskRunner({ concurrency: 2, timeoutMs: 5000 });
  });

  it('reports availability', () => {
    expect(runner.canAcceptTask).toBe(true);
    expect(runner.activeTaskCount).toBe(0);
  });

  it('executes a task successfully', async () => {
    const task = taskStore.createTask(db, {
      title: 'Test task',
      scheduleType: 'one_shot',
      status: 'scheduled',
      createdBy: 'user',
    });

    const status = await runner.executeTask(task.id, async () => {
      return { result: 'Done' };
    });

    expect(status).toBe('completed');
    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Done');
  });

  it('handles task failure with retry', async () => {
    const task = taskStore.createTask(db, {
      title: 'Failing task',
      scheduleType: 'one_shot',
      status: 'scheduled',
      createdBy: 'user',
    });

    const status = await runner.executeTask(task.id, async () => {
      return { error: 'Something went wrong' };
    });

    expect(status).toBe('scheduled'); // Rescheduled for retry
    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.retryCount).toBe(1);
    expect(updated.lastError).toBe('Something went wrong');
  });

  it('fails permanently after max retries', async () => {
    const task = taskStore.createTask(db, {
      title: 'Always fails',
      scheduleType: 'one_shot',
      status: 'scheduled',
      retryCount: 2, // Already retried twice
      createdBy: 'user',
    });
    // Set the retry count in DB
    taskStore.updateTask(db, task.id, { retryCount: 2 });

    const status = await runner.executeTask(task.id, async () => {
      return { error: 'Still failing' };
    });

    expect(status).toBe('failed');
    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('failed');
  });

  it('completes a recurring task and keeps it scheduled', () => {
    const task = taskStore.createTask(db, {
      title: 'Recurring',
      scheduleType: 'recurring',
      status: 'scheduled',
      cronExpression: '0 9 * * *',
      createdBy: 'mind',
    });

    runner.completeTask(task.id, 'Run completed');

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('scheduled');

    const runs = taskStore.getTaskRuns(db, task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('completed');
  });

  it('cancels a task', () => {
    const task = taskStore.createTask(db, {
      title: 'Cancel me',
      scheduleType: 'one_shot',
      status: 'scheduled',
      createdBy: 'user',
    });

    runner.cancelTask(task.id);
    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('cancelled');
  });

  it('handles thrown errors', async () => {
    const task = taskStore.createTask(db, {
      title: 'Throw task',
      scheduleType: 'one_shot',
      status: 'scheduled',
      createdBy: 'user',
    });

    const status = await runner.executeTask(task.id, async () => {
      throw new Error('Unexpected crash');
    });

    // Should retry
    expect(status).toBe('scheduled');
    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.lastError).toBe('Unexpected crash');
  });
});
