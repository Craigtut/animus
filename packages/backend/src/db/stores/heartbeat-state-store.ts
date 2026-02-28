/**
 * Heartbeat State Store — heartbeat_state table (singleton)
 */

import type Database from 'better-sqlite3';
import type { HeartbeatState } from '@animus-labs/shared';
import { snakeToCamel, intToBool } from '../utils.js';

export function getHeartbeatState(db: Database.Database): HeartbeatState {
  const row = db
    .prepare(
      `SELECT tick_number, current_stage, session_state, trigger_type,
              trigger_context, mind_session_id, session_token_count,
              started_at, last_tick_at, session_warm_since, is_running
       FROM heartbeat_state WHERE id = 1`
    )
    .get() as Record<string, unknown>;
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return { ...raw, isRunning: intToBool(raw['isRunning'] as number) } as HeartbeatState;
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
