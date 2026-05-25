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
    runner = new TaskRunner();
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

  it('completes a one-shot task', () => {
    const task = taskStore.createTask(db, {
      title: 'One shot',
      scheduleType: 'one_shot',
      status: 'in_progress',
      createdBy: 'user',
    });

    runner.completeTask(task.id, 'Done');

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Done');
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
});
