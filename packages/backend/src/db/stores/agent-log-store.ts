/**
 * Agent Log Store — data access for agent_logs.db
 *
 * Tables: agent_sessions, agent_events, agent_usage
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus/shared';
import type {
  AgentSession,
  AgentSessionStatus,
  AgentEvent,
  AgentEventType,
  AgentUsage,
  AgentProvider,
} from '@animus/shared';
import { snakeToCamel } from '../utils.js';

// ============================================================================
// Agent Sessions
// ============================================================================

export function createSession(
  db: Database.Database,
  data: { provider: AgentProvider; model?: string | null }
): AgentSession {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO agent_sessions (id, provider, model, started_at, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(id, data.provider, data.model ?? null, timestamp);
  return {
    id,
    provider: data.provider,
    model: data.model ?? null,
    startedAt: timestamp,
    endedAt: null,
    status: 'active',
  };
}

export function endSession(
  db: Database.Database,
  id: string,
  status: AgentSessionStatus
): void {
  db.prepare('UPDATE agent_sessions SET ended_at = ?, status = ? WHERE id = ?').run(
    now(),
    status,
    id
  );
}

export function getSession(db: Database.Database, id: string): AgentSession | null {
  const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? snakeToCamel<AgentSession>(row) : null;
}

export function listSessions(
  db: Database.Database,
  options: { limit?: number; offset?: number; status?: AgentSessionStatus } = {}
): { sessions: AgentSession[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM agent_sessions ${where}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(`SELECT * FROM agent_sessions ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return {
    sessions: rows.map((row) => snakeToCamel<AgentSession>(row)),
    total: totalRow.count,
  };
}

export function getAggregateUsage(
  db: Database.Database,
  options: { since?: string } = {}
): { totalInputTokens: number; totalOutputTokens: number; totalTokens: number; totalCostUsd: number; sessionCount: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.since) {
    conditions.push('created_at >= ?');
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) as total_input_tokens,
         COALESCE(SUM(output_tokens), 0) as total_output_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COUNT(DISTINCT session_id) as session_count
       FROM agent_usage ${where}`
    )
    .get(...params) as Record<string, number>;

  return {
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalTokens: row.total_tokens,
    totalCostUsd: row.total_cost_usd,
    sessionCount: row.session_count,
  };
}

// ============================================================================
// Agent Events
// ============================================================================

export function insertEvent(
  db: Database.Database,
  data: {
    sessionId: string;
    eventType: AgentEventType;
    data?: Record<string, unknown>;
  }
): AgentEvent {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO agent_events (id, session_id, event_type, data, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.sessionId, data.eventType, JSON.stringify(data.data ?? {}), timestamp);
  return {
    id,
    sessionId: data.sessionId,
    eventType: data.eventType,
    data: data.data ?? {},
    createdAt: timestamp,
  };
}

export function getSessionEvents(
  db: Database.Database,
  sessionId: string
): AgentEvent[] {
  const rows = db
    .prepare('SELECT * FROM agent_events WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const e = snakeToCamel<AgentEvent>(row);
    return {
      ...e,
      data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data,
    };
  });
}

// ============================================================================
// Agent Usage
// ============================================================================

export function insertUsage(
  db: Database.Database,
  data: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd?: number | null;
    model: string;
  }
): AgentUsage {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO agent_usage (id, session_id, input_tokens, output_tokens, total_tokens, cost_usd, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.sessionId,
    data.inputTokens,
    data.outputTokens,
    data.totalTokens,
    data.costUsd ?? null,
    data.model,
    timestamp
  );
  return {
    sessionId: data.sessionId,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens: data.totalTokens,
    costUsd: data.costUsd ?? null,
    model: data.model,
    createdAt: timestamp,
  };
}

export function getSessionUsage(db: Database.Database, sessionId: string): AgentUsage[] {
  const rows = db
    .prepare('SELECT * FROM agent_usage WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<AgentUsage>(row));
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanupOldSessions(db: Database.Database, retentionDays: number): number {
  const result = db
    .prepare(
      `DELETE FROM agent_sessions WHERE started_at < datetime('now', '-' || ? || ' days')`
    )
    .run(retentionDays);
  return result.changes;
}
