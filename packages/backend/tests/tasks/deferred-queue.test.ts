import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import * as taskStore from '../../src/db/stores/task-store.js';

// Mock DB access
vi.mock('../../src/db/index.js', () => {
  let mockDb: Database.Database;
  return {
    getHeartbeatDb: () => mockDb,
    getSystemDb: vi.fn(),
    getMessagesDb: vi.fn(),
    _setMockDb: (db: Database.Database) => { mockDb = db; },
  };
});

const { DeferredQueue, DEFERRED_AUTO_CANCEL_DAYS, DEFERRED_STALENESS_BOOST_DAYS } = await import('../../src/tasks/deferred-queue.js');
const dbModule = await import('../../src/db/index.js') as unknown as { _setMockDb: (db: Database.Database) => void };

describe('deferred-queue', () => {
  let db: Database.Database;
  let queue: InstanceType<typeof DeferredQueue>;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    (dbModule as { _setMockDb: (db: Database.Database) => void })._setMockDb(db);
    queue = new DeferredQueue();
  });

  describe('enqueue', () => {
    it('creates a deferred task', () => {
      const task = queue.enqueue({
        title: 'Research gardening',
        priority: 0.7,
      });
      expect(task.scheduleType).toBe('deferred');
      expect(task.status).toBe('scheduled');
      expect(task.priority).toBe(0.7);
    });

    it('defaults priority to 0.5', () => {
      const task = queue.enqueue({ title: 'Default priority' });
      expect(task.priority).toBe(0.5);
    });
  });

  describe('getNext', () => {
    it('returns highest priority task', () => {
      queue.enqueue({ title: 'Low', priority: 0.3 });
      queue.enqueue({ title: 'High', priority: 0.9 });
      queue.enqueue({ title: 'Medium', priority: 0.5 });

      const next = queue.getNext();
      expect(next).not.toBeNull();
      expect(next!.title).toBe('High');
    });

    it('returns null when empty', () => {
      expect(queue.getNext()).toBeNull();
    });
  });

  describe('getTopTasks', () => {
    it('returns top N tasks ordered by priority', () => {
      for (let i = 0; i < 10; i++) {
        queue.enqueue({ title: `Task ${i}`, priority: i * 0.1 });
      }
      const top = queue.getTopTasks(3);
      expect(top).toHaveLength(3);
      // Highest priority first
      expect(top[0]!.priority).toBeGreaterThanOrEqual(top[1]!.priority);
      expect(top[1]!.priority).toBeGreaterThanOrEqual(top[2]!.priority);
    });
  });

  describe('processStaleness', () => {
    it('auto-cancels old tasks', () => {
      // Create a task with a very old created_at
      const task = taskStore.createTask(db, {
        title: 'Old task',
        scheduleType: 'deferred',
        status: 'scheduled',
        priority: 0.5,
        createdBy: 'mind',
      });

      // Manually set created_at to 31 days ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - (DEFERRED_AUTO_CANCEL_DAYS + 1));
      db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(
        oldDate.toISOString(),
        task.id
      );

      const result = queue.processStaleness();
      expect(result.cancelled).toBe(1);

      const updated = taskStore.getTask(db, task.id)!;
      expect(updated.status).toBe('cancelled');
    });

    it('boosts priority of stale tasks', () => {
      const task = taskStore.createTask(db, {
        title: 'Stale task',
        scheduleType: 'deferred',
        status: 'scheduled',
        priority: 0.5,
        createdBy: 'mind',
      });

      // Set created_at to 10 days ago (past boost threshold, before cancel threshold)
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - (DEFERRED_STALENESS_BOOST_DAYS + 3));
      db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(
        staleDate.toISOString(),
        task.id
      );

      const result = queue.processStaleness();
      expect(result.boosted).toBe(1);

      const updated = taskStore.getTask(db, task.id)!;
      expect(updated.priority).toBeGreaterThan(0.5);
    });

    it('does nothing for fresh tasks', () => {
      queue.enqueue({ title: 'Fresh', priority: 0.5 });
      const result = queue.processStaleness();
      expect(result.boosted).toBe(0);
      expect(result.cancelled).toBe(0);
    });
  });
});
