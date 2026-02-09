/**
 * Heartbeat Store — data access for heartbeat.db
 *
 * Tables: heartbeat_state, emotion_state, emotion_history,
 *         thoughts, experiences, tick_decisions
 *
 * Goal/seed/plan/task store functions are deferred to Sprint 2.
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus/shared';
import type {
  HeartbeatState,
  HeartbeatStage,
  SessionState,
  TriggerType,
  EmotionState,
  EmotionName,
  EmotionHistoryEntry,
  Thought,
  Experience,
  TickDecision,
  DecisionType,
  DecisionOutcome,
} from '@animus/shared';
import { snakeToCamel, intToBool } from '../utils.js';

// ============================================================================
// Heartbeat State (singleton)
// ============================================================================

export function getHeartbeatState(db: Database.Database): HeartbeatState {
  const row = db
    .prepare(
      `SELECT tick_number, current_stage, session_state, trigger_type,
              trigger_context, mind_session_id, session_token_count,
              started_at, last_tick_at, session_warm_since, is_running
       FROM heartbeat_state WHERE id = 1`
    )
    .get() as Record<string, unknown>;
  const state = snakeToCamel<HeartbeatState & { isRunning: number }>(row);
  return { ...state, isRunning: intToBool(state.isRunning as unknown as number) };
}

export function updateHeartbeatState(
  db: Database.Database,
  data: Partial<
    Pick<
      HeartbeatState,
      | 'tickNumber'
      | 'currentStage'
      | 'sessionState'
      | 'triggerType'
      | 'triggerContext'
      | 'mindSessionId'
      | 'sessionTokenCount'
      | 'lastTickAt'
      | 'sessionWarmSince'
      | 'isRunning'
    >
  >
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    tickNumber: 'tick_number',
    currentStage: 'current_stage',
    sessionState: 'session_state',
    triggerType: 'trigger_type',
    triggerContext: 'trigger_context',
    mindSessionId: 'mind_session_id',
    sessionTokenCount: 'session_token_count',
    lastTickAt: 'last_tick_at',
    sessionWarmSince: 'session_warm_since',
    isRunning: 'is_running',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(camelKey === 'isRunning' ? (value ? 1 : 0) : value);
    }
  }

  if (fields.length === 0) return;
  values.push(1); // WHERE id = 1
  db.prepare(`UPDATE heartbeat_state SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================================================
// Emotions
// ============================================================================

export function getEmotionStates(db: Database.Database): EmotionState[] {
  const rows = db.prepare('SELECT * FROM emotion_state').all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<EmotionState>(row));
}

export function updateEmotionIntensity(
  db: Database.Database,
  emotion: EmotionName,
  intensity: number
): void {
  db.prepare(
    'UPDATE emotion_state SET intensity = ?, last_updated_at = ? WHERE emotion = ?'
  ).run(intensity, now(), emotion);
}

export function insertEmotionHistory(
  db: Database.Database,
  data: {
    tickNumber: number;
    emotion: EmotionName;
    delta: number;
    reasoning: string;
    intensityBefore: number;
    intensityAfter: number;
  }
): EmotionHistoryEntry {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO emotion_history (id, tick_number, emotion, delta, reasoning, intensity_before, intensity_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.tickNumber,
    data.emotion,
    data.delta,
    data.reasoning,
    data.intensityBefore,
    data.intensityAfter,
    timestamp
  );
  return { id, ...data, createdAt: timestamp };
}

// ============================================================================
// Thoughts
// ============================================================================

export function insertThought(
  db: Database.Database,
  data: { tickNumber: number; content: string; importance: number; expiresAt?: string | null }
): Thought {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO thoughts (id, tick_number, content, importance, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.tickNumber, data.content, data.importance, timestamp, data.expiresAt ?? null);
  return {
    id,
    tickNumber: data.tickNumber,
    content: data.content,
    importance: data.importance,
    createdAt: timestamp,
    expiresAt: data.expiresAt ?? null,
  };
}

export function getRecentThoughts(db: Database.Database, limit: number = 20): Thought[] {
  const rows = db
    .prepare('SELECT * FROM thoughts ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Thought>(row));
}

// ============================================================================
// Experiences
// ============================================================================

export function insertExperience(
  db: Database.Database,
  data: { tickNumber: number; content: string; importance: number; expiresAt?: string | null }
): Experience {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO experiences (id, tick_number, content, importance, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.tickNumber, data.content, data.importance, timestamp, data.expiresAt ?? null);
  return {
    id,
    tickNumber: data.tickNumber,
    content: data.content,
    importance: data.importance,
    createdAt: timestamp,
    expiresAt: data.expiresAt ?? null,
  };
}

export function getRecentExperiences(db: Database.Database, limit: number = 20): Experience[] {
  const rows = db
    .prepare('SELECT * FROM experiences ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Experience>(row));
}

// ============================================================================
// Tick Decisions
// ============================================================================

export function insertTickDecision(
  db: Database.Database,
  data: {
    tickNumber: number;
    type: DecisionType;
    description: string;
    parameters?: Record<string, unknown> | null;
    outcome: DecisionOutcome;
    outcomeDetail?: string | null;
  }
): TickDecision {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO tick_decisions (id, tick_number, type, description, parameters, outcome, outcome_detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.tickNumber,
    data.type,
    data.description,
    data.parameters ? JSON.stringify(data.parameters) : null,
    data.outcome,
    data.outcomeDetail ?? null,
    timestamp
  );
  return {
    id,
    tickNumber: data.tickNumber,
    type: data.type,
    description: data.description,
    parameters: data.parameters ?? null,
    outcome: data.outcome,
    outcomeDetail: data.outcomeDetail ?? null,
    createdAt: timestamp,
  };
}

export function getTickDecisions(
  db: Database.Database,
  tickNumber: number
): TickDecision[] {
  const rows = db
    .prepare('SELECT * FROM tick_decisions WHERE tick_number = ? ORDER BY created_at')
    .all(tickNumber) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const d = snakeToCamel<TickDecision>(row);
    return {
      ...d,
      parameters: typeof d.parameters === 'string' ? JSON.parse(d.parameters) : d.parameters,
    };
  });
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanupExpiredEntries(db: Database.Database): {
  thoughts: number;
  experiences: number;
} {
  const timestamp = now();
  const thoughtsResult = db
    .prepare('DELETE FROM thoughts WHERE expires_at IS NOT NULL AND expires_at < ?')
    .run(timestamp);
  const experiencesResult = db
    .prepare('DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at < ?')
    .run(timestamp);
  return {
    thoughts: thoughtsResult.changes,
    experiences: experiencesResult.changes,
  };
}
