/**
 * Experience Store — experiences table
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { Experience } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

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

/**
 * Get all experiences since a given timestamp (exclusive), newest first.
 * Used by the observation pipeline to load all unsummarized items.
 */
export function getExperiencesSince(db: Database.Database, since: string, limit: number = 2000): Experience[] {
  const rows = db
    .prepare('SELECT * FROM experiences WHERE created_at > ? ORDER BY created_at DESC LIMIT ?')
    .all(since, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Experience>(row));
}

export function getExperiencesPaginated(
  db: Database.Database,
  limit: number = 20,
  cursor?: string,
  importantOnly?: boolean
): Experience[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (cursor) {
    conditions.push('created_at < ?');
    params.push(cursor);
  }
  if (importantOnly) {
    conditions.push('importance > 0.7');
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const rows = db
    .prepare(`SELECT * FROM experiences ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Experience>(row));
}

/**
 * Delete expired experiences (TTL-based cleanup).
 */
export function cleanupExpiredExperiences(db: Database.Database): number {
  const timestamp = now();
  const result = db
    .prepare('DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at < ?')
    .run(timestamp);
  return result.changes;
}
