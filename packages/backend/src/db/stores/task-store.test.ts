import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as taskStore from './task-store.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      schedule_type TEXT NOT NULL DEFAULT 'one_shot',
      cron_expression TEXT,
      scheduled_at TEXT,
      next_run_at TEXT,
      goal_id TEXT,
      plan_id TEXT,
      milestone_id TEXT,
      milestone_index INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      priority REAL NOT NULL DEFAULT 0.5,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      result TEXT,
      created_by TEXT NOT NULL DEFAULT 'mind',
      contact_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE task_journals (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'not_started',
      handoff TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      learned TEXT NOT NULL DEFAULT '[]',
      decisions TEXT NOT NULL DEFAULT '[]',
      artifacts TEXT NOT NULL DEFAULT '[]',
      open_questions TEXT NOT NULL DEFAULT '[]',
      next_steps TEXT NOT NULL DEFAULT '[]',
      token_count INTEGER NOT NULL DEFAULT 0,
      updated_tick_number INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
});

afterEach(() => {
  db.close();
});

describe('task journals', () => {
  it('creates an empty journal row for new tasks', () => {
    const task = taskStore.createTask(db, {
      title: 'Research Ghostty rendering',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
    });

    const journal = taskStore.getTaskJournal(db, task.id);

    expect(journal).toMatchObject({
      taskId: task.id,
      status: 'not_started',
      handoff: '',
      learned: [],
      artifacts: [],
    });
    expect(() => new Date(journal!.createdAt).toISOString()).not.toThrow();
  });

  it('replaces journal continuity fields and artifact context', () => {
    const task = taskStore.createTask(db, {
      title: 'Research terminal rendering',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
    });

    const journal = taskStore.updateTaskJournal(db, {
      taskId: task.id,
      status: 'in_progress',
      handoff: 'Compare the libghostty embedding examples next.',
      summary: 'Found the likely embedding boundary.',
      learned: ['libghostty exposes an embeddable app/runtime surface.'],
      decisions: ['Keep the integration inside the native shell boundary.'],
      artifacts: [{
        label: 'tool result 18',
        type: 'tool_result',
        ref: '/tmp/tool-results/tick-18/result.json',
        context: 'Search output with the most relevant libghostty API notes.',
      }],
      openQuestions: ['How stable is the app runtime API?'],
      nextSteps: ['Read the upstream example source.'],
      updatedTickNumber: 42,
    });

    expect(journal.status).toBe('in_progress');
    expect(journal.handoff).toContain('libghostty');
    expect(journal.artifacts[0]).toMatchObject({
      label: 'tool result 18',
      context: expect.stringContaining('API notes'),
    });
    expect(journal.updatedTickNumber).toBe(42);
    expect(journal.tokenCount).toBeGreaterThan(0);
  });

  it('resolves unique task ID prefixes', () => {
    const task = taskStore.createTask(db, {
      title: 'Continue task',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
    });

    expect(taskStore.resolveTaskId(db, task.id.slice(0, 8))).toBe(task.id);
  });

  it('treats task ID prefixes as literal text, not SQL wildcards', () => {
    taskStore.createTask(db, {
      title: 'Only task',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
    });

    expect(taskStore.resolveTaskId(db, '%')).toBeNull();
    expect(taskStore.resolveTaskId(db, '_')).toBeNull();
  });

  it('lets lifecycle status updates win while preserving journal content', () => {
    const task = taskStore.createTask(db, {
      title: 'Complete after reflection',
      scheduleType: 'deferred',
      status: 'in_progress',
      createdBy: 'mind',
    });

    taskStore.updateTaskJournal(db, {
      taskId: task.id,
      status: 'in_progress',
      handoff: 'No more work remains.',
      summary: 'The work is ready to close.',
      learned: ['The final source checked out.'],
      decisions: [],
      artifacts: [],
      openQuestions: [],
      nextSteps: [],
      updatedTickNumber: 7,
    });

    const journal = taskStore.updateTaskJournalStatus(db, task.id, 'complete', 7);

    expect(journal).toMatchObject({
      status: 'complete',
      handoff: 'No more work remains.',
      summary: 'The work is ready to close.',
    });
  });

  it('surfaces in-progress deferred tasks before scheduled tasks', () => {
    const scheduled = taskStore.createTask(db, {
      title: 'Scheduled',
      scheduleType: 'deferred',
      status: 'scheduled',
      priority: 1,
      createdBy: 'mind',
    });
    const active = taskStore.createTask(db, {
      title: 'Active',
      scheduleType: 'deferred',
      status: 'in_progress',
      priority: 0.1,
      createdBy: 'mind',
    });

    const tasks = taskStore.getDeferredTasksForContext(db, 5);

    expect(tasks.map(task => task.id)).toEqual([active.id, scheduled.id]);
  });
});
