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
