/**
 * Agent Task Store — agent_tasks table
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

export function insertAgentTask(
  db: Database.Database,
  data: {
    id: string;
    tickNumber: number;
    sessionId: string | null;
    provider: string;
    status: string;
    taskType: string;
    taskDescription: string;
    contactId: string | null;
    sourceChannel: string | null;
    createdAt: string;
  }
): void {
  db.prepare(
    `INSERT INTO agent_tasks (id, tick_number, session_id, provider, status, task_type, task_description, contact_id, source_channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id, data.tickNumber, data.sessionId, data.provider,
    data.status, data.taskType, data.taskDescription,
    data.contactId, data.sourceChannel, data.createdAt
  );
}

export function updateAgentTask(
  db: Database.Database,
  id: string,
  data: Partial<{
    sessionId: string | null;
    status: string;
    currentActivity: string | null;
    result: string | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  const mapping: Record<string, string> = {
    sessionId: 'session_id',
    status: 'status',
    currentActivity: 'current_activity',
    result: 'result',
    error: 'error',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    inputTokens: 'input_tokens',
    outputTokens: 'output_tokens',
    totalCostUsd: 'total_cost_usd',
  };
  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) { fields.push(`${snakeKey} = ?`); values.push(value); }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getAgentTask(db: Database.Database, id: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<Record<string, unknown>>(row) : null;
}

export function getRunningAgentTasks(db: Database.Database): Array<Record<string, unknown>> {
  const rows = db.prepare(
    "SELECT * FROM agent_tasks WHERE status IN ('spawning', 'running') ORDER BY created_at"
  ).all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Record<string, unknown>>(row));
}

export function getRecentAgentTasks(db: Database.Database, limit: number = 20): Array<Record<string, unknown>> {
  const rows = db.prepare(
    'SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Record<string, unknown>>(row));
}

/**
 * Get all non-null session IDs from agent_tasks.
 * Used to scope usage queries to sub-agent sessions only.
 */
export function getAgentTaskSessionIds(db: Database.Database): string[] {
  const rows = db.prepare(
    'SELECT DISTINCT session_id FROM agent_tasks WHERE session_id IS NOT NULL'
  ).all() as Array<{ session_id: string }>;
  return rows.map((r) => r.session_id);
}

/**
 * Mark orphaned agent tasks (status='running' or 'spawning') as 'failed'.
 * Called during startup recovery to clean up tasks from a previous crash.
 */
export function markOrphanedAgentTasks(db: Database.Database): number {
  const timestamp = now();
  const result = db.prepare(
    "UPDATE agent_tasks SET status = 'failed', error = 'Orphaned on restart', completed_at = ? WHERE status IN ('running', 'spawning')"
  ).run(timestamp);
  return result.changes;
}
