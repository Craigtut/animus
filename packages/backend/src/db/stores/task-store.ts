/**
 * Task Store — data access for task-related tables in heartbeat.db
 *
 * Tables: tasks, task_runs
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  Task,
  TaskJournal,
  TaskJournalArtifact,
  TaskJournalStatus,
  TaskJournalUpdate,
  TaskRun,
  TaskStatus,
  TaskRunStatus,
  ScheduleType,
  TaskCreatedBy,
} from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

// ============================================================================
// Tasks
// ============================================================================

function rowToTask(row: Record<string, unknown>): Task {
  const t = snakeToCamel<Task>(row);
  return t;
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function estimateJournalTokens(update: {
  handoff: string;
  summary: string;
  learned: string[];
  decisions: string[];
  artifacts: TaskJournalArtifact[];
  openQuestions: string[];
  nextSteps: string[];
}): number {
  const chars =
    update.handoff.length +
    update.summary.length +
    update.learned.join('\n').length +
    update.decisions.join('\n').length +
    JSON.stringify(update.artifacts).length +
    update.openQuestions.join('\n').length +
    update.nextSteps.join('\n').length;
  return Math.ceil(chars / 4);
}

function rowToTaskJournal(row: Record<string, unknown>): TaskJournal {
  return {
    taskId: String(row['task_id']),
    status: String(row['status']) as TaskJournalStatus,
    handoff: String(row['handoff'] ?? ''),
    summary: String(row['summary'] ?? ''),
    learned: parseJsonArray<string>(row['learned']),
    decisions: parseJsonArray<string>(row['decisions']),
    artifacts: parseJsonArray<TaskJournalArtifact>(row['artifacts']),
    openQuestions: parseJsonArray<string>(row['open_questions']),
    nextSteps: parseJsonArray<string>(row['next_steps']),
    tokenCount: Number(row['token_count'] ?? 0),
    updatedTickNumber: row['updated_tick_number'] == null ? null : Number(row['updated_tick_number']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export interface CreateTaskData {
  title: string;
  description?: string | null;
  instructions?: string | null;
  scheduleType: ScheduleType;
  cronExpression?: string | null;
  scheduledAt?: string | null;
  nextRunAt?: string | null;
  goalId?: string | null;
  planId?: string | null;
  milestoneId?: string | null;
  milestoneIndex?: number | null;
  status?: TaskStatus;
  priority?: number;
  createdBy: TaskCreatedBy;
  contactId?: string | null;
}

export function createTask(db: Database.Database, data: CreateTaskData): Task {
  const id = generateUUID();
  const timestamp = now();
  const status = data.status ?? 'pending';
  const priority = data.priority ?? 0.5;

  db.prepare(
    `INSERT INTO tasks (id, title, description, instructions,
       schedule_type, cron_expression, scheduled_at, next_run_at,
       goal_id, plan_id, milestone_id, milestone_index,
       status, priority,
       created_by, contact_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.title,
    data.description ?? null,
    data.instructions ?? null,
    data.scheduleType,
    data.cronExpression ?? null,
    data.scheduledAt ?? null,
    data.nextRunAt ?? null,
    data.goalId ?? null,
    data.planId ?? null,
    data.milestoneId ?? null,
    data.milestoneIndex ?? null,
    status,
    priority,
    data.createdBy,
    data.contactId ?? null,
    timestamp,
    timestamp
  );

  ensureTaskJournal(db, id);

  return {
    id,
    title: data.title,
    description: data.description ?? null,
    instructions: data.instructions ?? null,
    scheduleType: data.scheduleType,
    cronExpression: data.cronExpression ?? null,
    scheduledAt: data.scheduledAt ?? null,
    nextRunAt: data.nextRunAt ?? null,
    goalId: data.goalId ?? null,
    planId: data.planId ?? null,
    milestoneId: data.milestoneId ?? null,
    milestoneIndex: data.milestoneIndex ?? null,
    status,
    priority,
    retryCount: 0,
    lastError: null,
    result: null,
    createdBy: data.createdBy,
    contactId: data.contactId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Resolve a task ID from either a full UUID or a unique UUID prefix.
 */
export function resolveTaskId(db: Database.Database, taskIdOrPrefix: string): string | null {
  const value = taskIdOrPrefix.trim();
  if (!value) return null;

  const exact = db.prepare('SELECT id FROM tasks WHERE id = ?').get(value) as
    | { id: string }
    | undefined;
  if (exact) return exact.id;

  const rows = db
    .prepare('SELECT id FROM tasks WHERE substr(id, 1, ?) = ? ORDER BY created_at DESC LIMIT 2')
    .all(value.length, value) as Array<{ id: string }>;
  return rows.length === 1 ? rows[0]!.id : null;
}

export function getTask(db: Database.Database, id: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row) : null;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  instructions?: string | null;
  cronExpression?: string | null;
  scheduledAt?: string | null;
  nextRunAt?: string | null;
  goalId?: string | null;
  planId?: string | null;
  milestoneId?: string | null;
  milestoneIndex?: number | null;
  status?: TaskStatus;
  priority?: number;
  retryCount?: number;
  lastError?: string | null;
  result?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export function updateTask(
  db: Database.Database,
  id: string,
  data: UpdateTaskData
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    title: 'title',
    description: 'description',
    instructions: 'instructions',
    cronExpression: 'cron_expression',
    scheduledAt: 'scheduled_at',
    nextRunAt: 'next_run_at',
    goalId: 'goal_id',
    planId: 'plan_id',
    milestoneId: 'milestone_id',
    milestoneIndex: 'milestone_index',
    status: 'status',
    priority: 'priority',
    retryCount: 'retry_count',
    lastError: 'last_error',
    result: 'result',
    startedAt: 'started_at',
    completedAt: 'completed_at',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values
  );
}

export function deleteTask(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

export interface ListTasksFilters {
  status?: TaskStatus;
  scheduleType?: ScheduleType;
  contactId?: string;
  goalId?: string;
  milestoneId?: string;
}

export function listTasks(
  db: Database.Database,
  filters?: ListTasksFilters
): Task[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.scheduleType) {
    conditions.push('schedule_type = ?');
    params.push(filters.scheduleType);
  }
  if (filters?.contactId) {
    conditions.push('contact_id = ?');
    params.push(filters.contactId);
  }
  if (filters?.goalId) {
    conditions.push('goal_id = ?');
    params.push(filters.goalId);
  }
  if (filters?.milestoneId) {
    conditions.push('milestone_id = ?');
    params.push(filters.milestoneId);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

export function countOpenTasksByGoal(db: Database.Database, goalId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) as count
     FROM tasks
     WHERE goal_id = ?
       AND status IN ('pending', 'scheduled', 'in_progress', 'paused')`
  ).get(goalId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function countOpenTasksByMilestone(db: Database.Database, milestoneId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) as count
     FROM tasks
     WHERE milestone_id = ?
       AND status IN ('pending', 'scheduled', 'in_progress', 'paused')`
  ).get(milestoneId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Get tasks that are due for execution (next_run_at <= now).
 * Only returns tasks with status 'scheduled'.
 */
export function getDueTasks(
  db: Database.Database,
  asOfTime: string
): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE status = 'scheduled'
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?
       ORDER BY next_run_at ASC`
    )
    .all(asOfTime) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

/**
 * Get the next deferred task to process (highest priority first).
 */
export function getNextDeferredTask(db: Database.Database): Task | null {
  const row = db
    .prepare(
      `SELECT * FROM tasks
       WHERE schedule_type = 'deferred'
         AND status = 'scheduled'
       ORDER BY priority DESC
       LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

/**
 * Get top N deferred tasks for context display.
 */
export function getTopDeferredTasks(
  db: Database.Database,
  limit: number = 5
): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE schedule_type = 'deferred'
         AND status = 'scheduled'
       ORDER BY priority DESC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

/**
 * Get deferred tasks to surface to the mind during interval ticks.
 * In-progress deferred tasks stay visible until completed.
 */
export function getDeferredTasksForContext(
  db: Database.Database,
  limit: number = 5
): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE schedule_type = 'deferred'
         AND status IN ('in_progress', 'scheduled')
       ORDER BY
         CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
         priority DESC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

// ============================================================================
// Task Journals
// ============================================================================

export function ensureTaskJournal(db: Database.Database, taskId: string): TaskJournal {
  const timestamp = now();
  db.prepare(
    `INSERT OR IGNORE INTO task_journals (task_id, created_at, updated_at)
     VALUES (?, ?, ?)`
  ).run(taskId, timestamp, timestamp);

  const journal = getTaskJournal(db, taskId);
  if (!journal) {
    throw new Error(`Failed to create task journal for task ${taskId}`);
  }
  return journal;
}

export function getTaskJournal(db: Database.Database, taskId: string): TaskJournal | null {
  const row = db.prepare('SELECT * FROM task_journals WHERE task_id = ?').get(taskId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTaskJournal(row) : null;
}

export function getTaskJournals(db: Database.Database, taskIds: string[]): TaskJournal[] {
  const uniqueIds = [...new Set(taskIds)].filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM task_journals WHERE task_id IN (${placeholders})`)
    .all(...uniqueIds) as Array<Record<string, unknown>>;
  return rows.map(rowToTaskJournal);
}

export function updateTaskJournal(
  db: Database.Database,
  update: TaskJournalUpdate & { updatedTickNumber?: number | null }
): TaskJournal {
  const taskId = resolveTaskId(db, update.taskId);
  if (!taskId) {
    throw new Error(`Task not found or ambiguous for journal update: ${update.taskId}`);
  }
  ensureTaskJournal(db, taskId);

  const timestamp = now();
  const tokenCount = estimateJournalTokens(update);
  db.prepare(
    `UPDATE task_journals SET
       status = ?,
       handoff = ?,
       summary = ?,
       learned = ?,
       decisions = ?,
       artifacts = ?,
       open_questions = ?,
       next_steps = ?,
       token_count = ?,
       updated_tick_number = ?,
       updated_at = ?
     WHERE task_id = ?`
  ).run(
    update.status,
    update.handoff,
    update.summary,
    JSON.stringify(update.learned),
    JSON.stringify(update.decisions),
    JSON.stringify(update.artifacts),
    JSON.stringify(update.openQuestions),
    JSON.stringify(update.nextSteps),
    tokenCount,
    update.updatedTickNumber ?? null,
    timestamp,
    taskId
  );

  const journal = getTaskJournal(db, taskId);
  if (!journal) {
    throw new Error(`Failed to update task journal for task ${taskId}`);
  }
  return journal;
}

export function updateTaskJournalStatus(
  db: Database.Database,
  taskId: string,
  status: TaskJournalStatus,
  updatedTickNumber?: number
): TaskJournal | null {
  const resolvedTaskId = resolveTaskId(db, taskId);
  if (!resolvedTaskId) return null;
  ensureTaskJournal(db, resolvedTaskId);

  db.prepare(
    `UPDATE task_journals
     SET status = ?, updated_tick_number = ?, updated_at = ?
     WHERE task_id = ?`
  ).run(status, updatedTickNumber ?? null, now(), resolvedTaskId);

  return getTaskJournal(db, resolvedTaskId);
}

/**
 * Get all scheduled/recurring active tasks (for scheduler startup).
 */
export function getActiveScheduledTasks(db: Database.Database): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE status = 'scheduled'
         AND schedule_type IN ('one_shot', 'recurring')
       ORDER BY next_run_at ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

/**
 * Cancel tasks belonging to a goal.
 */
export function cancelTasksByGoalId(
  db: Database.Database,
  goalId: string
): number {
  const result = db
    .prepare(
      `UPDATE tasks SET status = 'cancelled', updated_at = ?, completed_at = ?
       WHERE goal_id = ? AND status IN ('pending', 'scheduled', 'paused')`
    )
    .run(now(), now(), goalId);
  return result.changes;
}

/**
 * Pause tasks belonging to a goal.
 */
export function pauseTasksByGoalId(
  db: Database.Database,
  goalId: string
): number {
  const result = db
    .prepare(
      `UPDATE tasks SET status = 'paused', updated_at = ?
       WHERE goal_id = ? AND status IN ('pending', 'scheduled')`
    )
    .run(now(), goalId);
  return result.changes;
}

// ============================================================================
// Task Runs
// ============================================================================

export interface CreateTaskRunData {
  taskId: string;
  status?: TaskRunStatus;
}

export function createTaskRun(
  db: Database.Database,
  data: CreateTaskRunData
): TaskRun {
  const id = generateUUID();
  const timestamp = now();
  const status = data.status ?? 'completed';

  db.prepare(
    `INSERT INTO task_runs (id, task_id, status, started_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, data.taskId, status, timestamp);

  return {
    id,
    taskId: data.taskId,
    status,
    result: null,
    error: null,
    agentTaskId: null,
    retryCount: 0,
    startedAt: timestamp,
    completedAt: null,
  };
}

export interface UpdateTaskRunData {
  status?: TaskRunStatus;
  result?: string | null;
  error?: string | null;
  agentTaskId?: string | null;
  retryCount?: number;
  completedAt?: string | null;
}

export function updateTaskRun(
  db: Database.Database,
  id: string,
  data: UpdateTaskRunData
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    status: 'status',
    result: 'result',
    error: 'error',
    agentTaskId: 'agent_task_id',
    retryCount: 'retry_count',
    completedAt: 'completed_at',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE task_runs SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values
  );
}

export function getTaskRuns(
  db: Database.Database,
  taskId: string
): TaskRun[] {
  const rows = db
    .prepare(
      'SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC'
    )
    .all(taskId) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<TaskRun>(row));
}

/**
 * Count consecutive failed runs for a recurring task.
 */
export function getConsecutiveFailureCount(
  db: Database.Database,
  taskId: string
): number {
  const rows = db
    .prepare(
      `SELECT status FROM task_runs
       WHERE task_id = ?
       ORDER BY started_at DESC
       LIMIT 10`
    )
    .all(taskId) as Array<{ status: string }>;

  let count = 0;
  for (const row of rows) {
    if (row.status === 'failed') count++;
    else break;
  }
  return count;
}

/**
 * Clean up old task runs (TTL-based).
 */
export function cleanupOldTaskRuns(
  db: Database.Database,
  retentionDays: number
): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const result = db
    .prepare(
      `DELETE FROM task_runs WHERE started_at < ?`
    )
    .run(cutoff.toISOString());
  return result.changes;
}
