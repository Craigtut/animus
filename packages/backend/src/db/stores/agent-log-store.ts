/**
 * Agent Log Store — data access for agent_logs.db
 *
 * Tables: agent_sessions, agent_events, agent_usage
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  AgentSession,
  AgentSessionStatus,
  AgentEvent,
  AgentEventType,
  AgentUsage,
  AgentProvider,
} from '@animus-labs/shared';
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
    totalInputTokens: row['total_input_tokens'] ?? 0,
    totalOutputTokens: row['total_output_tokens'] ?? 0,
    totalTokens: row['total_tokens'] ?? 0,
    totalCostUsd: row['total_cost_usd'] ?? 0,
    sessionCount: row['session_count'] ?? 0,
  };
}

/**
 * Get aggregate usage scoped to specific session IDs.
 * Used to compute sub-agent-only usage by passing session IDs from agent_tasks.
 */
export function getAggregateUsageForSessions(
  db: Database.Database,
  sessionIds: string[]
): { totalInputTokens: number; totalOutputTokens: number; totalTokens: number; totalCostUsd: number; sessionCount: number } {
  if (sessionIds.length === 0) {
    return { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCostUsd: 0, sessionCount: 0 };
  }

  const placeholders = sessionIds.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) as total_input_tokens,
         COALESCE(SUM(output_tokens), 0) as total_output_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COUNT(DISTINCT session_id) as session_count
       FROM agent_usage WHERE session_id IN (${placeholders})`
    )
    .get(...sessionIds) as Record<string, number>;

  return {
    totalInputTokens: row['total_input_tokens'] ?? 0,
    totalOutputTokens: row['total_output_tokens'] ?? 0,
    totalTokens: row['total_tokens'] ?? 0,
    totalCostUsd: row['total_cost_usd'] ?? 0,
    sessionCount: row['session_count'] ?? 0,
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
// Tick Events (for Heartbeat Inspector)
// ============================================================================

export function getTickEvents(
  db: Database.Database,
  tickNumber: number
): { input: AgentEvent | null; output: AgentEvent | null } {
  const inputRow = db
    .prepare(
      `SELECT * FROM agent_events
       WHERE event_type = 'tick_input'
         AND JSON_EXTRACT(data, '$.tickNumber') = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tickNumber) as Record<string, unknown> | undefined;

  const outputRow = db
    .prepare(
      `SELECT * FROM agent_events
       WHERE event_type = 'tick_output'
         AND JSON_EXTRACT(data, '$.tickNumber') = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tickNumber) as Record<string, unknown> | undefined;

  const parse = (row: Record<string, unknown> | undefined): AgentEvent | null => {
    if (!row) return null;
    const e = snakeToCamel<AgentEvent>(row);
    return {
      ...e,
      data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data,
    };
  };

  return { input: parse(inputRow), output: parse(outputRow) };
}

export function listTickEvents(
  db: Database.Database,
  options: { limit?: number; offset?: number } = {}
): { events: AgentEvent[]; total: number } {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM agent_events WHERE event_type = 'tick_input'`)
    .get() as { count: number };

  const rows = db
    .prepare(
      `SELECT * FROM agent_events
       WHERE event_type = 'tick_input'
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<Record<string, unknown>>;

  return {
    events: rows.map((row) => {
      const e = snakeToCamel<AgentEvent>(row);
      return {
        ...e,
        data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data,
      };
    }),
    total: totalRow.count,
  };
}

/**
 * Find the most recent tick_input event with a non-null systemPrompt.
 * Used to resolve the system prompt for warm sessions.
 */
export function getLastColdSystemPrompt(
  db: Database.Database,
): string | null {
  const row = db
    .prepare(
      `SELECT * FROM agent_events
       WHERE event_type = 'tick_input'
         AND JSON_EXTRACT(data, '$.systemPrompt') IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;

  if (!row) return null;
  const e = snakeToCamel<AgentEvent>(row);
  const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  return (data as Record<string, unknown>)['systemPrompt'] as string | null;
}

// ============================================================================
// Timeline (for Agent Timeline feature)
// ============================================================================

export interface TimelineEvent {
  id: string;
  sessionId: string;
  eventType: AgentEventType;
  data: Record<string, unknown>;
  createdAt: string;
  relativeMs: number;
}

/**
 * Get all events for a specific tick, ordered chronologically with relativeMs
 * computed from the earliest SDK event (not tick_input).
 *
 * tick_input is logged AFTER mindQuery returns, so SDK events (thinking, tool calls,
 * response) have earlier timestamps. We use timestamp-based windowing:
 * - Lower bound: previous tick_output for this session (or epoch for first tick)
 * - Upper bound: this tick's tick_output (or no upper bound if in progress)
 *
 * tick_input is pinned first, tick_output is pinned last.
 * response_chunk events are excluded (too noisy).
 */
export function getTimelineForTick(
  db: Database.Database,
  tickNumber: number
): TimelineEvent[] | null {
  // 1. Find the tick_input event for this tick number
  const tickInputRow = db
    .prepare(
      `SELECT * FROM agent_events
       WHERE event_type = 'tick_input'
         AND JSON_EXTRACT(data, '$.tickNumber') = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tickNumber) as Record<string, unknown> | undefined;

  if (!tickInputRow) return null;

  const tickInput = snakeToCamel<AgentEvent>(tickInputRow);
  const sessionId = tickInput.sessionId;

  // 2. Find previous tick_output for this session (lower time bound)
  const prevOutputRow = db
    .prepare(
      `SELECT created_at FROM agent_events
       WHERE session_id = ?
         AND event_type = 'tick_output'
         AND created_at < ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(sessionId, tickInput.createdAt) as { created_at: string } | undefined;

  const lowerBound = prevOutputRow?.created_at ?? '1970-01-01T00:00:00.000Z';

  // 3. Find this tick's tick_output (upper time bound)
  const tickOutputRow = db
    .prepare(
      `SELECT * FROM agent_events
       WHERE event_type = 'tick_output'
         AND session_id = ?
         AND JSON_EXTRACT(data, '$.tickNumber') = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(sessionId, tickNumber) as Record<string, unknown> | undefined;

  // 4. Query all events in the window, excluding response_chunk
  let rows: Array<Record<string, unknown>>;
  if (tickOutputRow) {
    const tickOutput = snakeToCamel<AgentEvent>(tickOutputRow);
    rows = db
      .prepare(
        `SELECT * FROM agent_events
         WHERE session_id = ?
           AND event_type != 'response_chunk'
           AND created_at > ?
           AND created_at <= ?
         ORDER BY created_at`
      )
      .all(sessionId, lowerBound, tickOutput.createdAt) as Array<Record<string, unknown>>;
  } else {
    // In-progress tick: no upper bound
    rows = db
      .prepare(
        `SELECT * FROM agent_events
         WHERE session_id = ?
           AND event_type != 'response_chunk'
           AND created_at > ?
         ORDER BY created_at`
      )
      .all(sessionId, lowerBound) as Array<Record<string, unknown>>;
  }

  // 5. Parse all events
  const events = rows.map((row) => {
    const e = snakeToCamel<AgentEvent>(row);
    return {
      ...e,
      data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data,
    };
  });

  // 6. Find the earliest SDK event timestamp (not tick_input or tick_output)
  const sdkEvents = events.filter(
    (e) => e.eventType !== 'tick_input' && e.eventType !== 'tick_output'
  );
  const baseTime = sdkEvents.length > 0
    ? new Date(sdkEvents[0]!.createdAt).getTime()
    : new Date(tickInput.createdAt).getTime();

  // 7. Re-order: tick_input first, tick_output last, everything else by timestamp
  const tickInputEvents = events.filter((e) => e.eventType === 'tick_input');
  const tickOutputEvents = events.filter((e) => e.eventType === 'tick_output');
  const middleEvents = events.filter(
    (e) => e.eventType !== 'tick_input' && e.eventType !== 'tick_output'
  );

  const ordered = [...tickInputEvents, ...middleEvents, ...tickOutputEvents];

  // 8. Compute relativeMs
  return ordered.map((e) => ({
    id: e.id,
    sessionId: e.sessionId,
    eventType: e.eventType,
    data: e.data as Record<string, unknown>,
    createdAt: e.createdAt,
    relativeMs: Math.max(0, new Date(e.createdAt).getTime() - baseTime),
  }));
}

// ============================================================================
// Orphan Recovery
// ============================================================================

/**
 * Mark orphaned sessions (status='active') as 'error'.
 * Called during startup recovery to clean up sessions from a previous crash.
 */
export function markOrphanedSessions(db: Database.Database): number {
  const timestamp = now();
  const result = db.prepare(
    "UPDATE agent_sessions SET ended_at = ?, status = 'error' WHERE status = 'active'"
  ).run(timestamp);
  return result.changes;
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
