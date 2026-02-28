/**
 * Emotion Store — emotion_state and emotion_history tables
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { EmotionState, EmotionName, EmotionHistoryEntry } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

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

export function getEmotionHistory(
  db: Database.Database,
  options: { emotion?: EmotionName; since?: string; limit?: number } = {}
): EmotionHistoryEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.emotion) {
    conditions.push('emotion = ?');
    params.push(options.emotion);
  }
  if (options.since) {
    conditions.push('created_at >= ?');
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;

  const rows = db
    .prepare(`SELECT * FROM emotion_history ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<EmotionHistoryEntry>(row));
}

export function cleanupOldEmotionHistory(db: Database.Database, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare('DELETE FROM emotion_history WHERE created_at < ?')
    .run(cutoff);
  return result.changes;
}
