/**
 * Memory Store — data access for memory.db
 *
 * Tables: working_memory, core_self, long_term_memories, observations
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus/shared';
import type {
  WorkingMemory,
  CoreSelf,
  LongTermMemory,
  MemoryType,
  MemorySourceType,
  Observation,
  StreamType,
} from '@animus/shared';
import { snakeToCamel } from '../utils.js';

// ============================================================================
// Working Memory
// ============================================================================

export function getWorkingMemory(
  db: Database.Database,
  contactId: string
): WorkingMemory | null {
  const row = db
    .prepare('SELECT * FROM working_memory WHERE contact_id = ?')
    .get(contactId) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<WorkingMemory>(row) : null;
}

export function upsertWorkingMemory(
  db: Database.Database,
  contactId: string,
  content: string,
  tokenCount: number
): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO working_memory (contact_id, content, token_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(contact_id) DO UPDATE SET
       content = excluded.content,
       token_count = excluded.token_count,
       updated_at = excluded.updated_at`
  ).run(contactId, content, tokenCount, timestamp, timestamp);
}

// ============================================================================
// Core Self (singleton)
// ============================================================================

export function getCoreSelf(db: Database.Database): CoreSelf | null {
  const row = db
    .prepare('SELECT * FROM core_self WHERE id = 1')
    .get() as Record<string, unknown> | undefined;
  return row ? snakeToCamel<CoreSelf>(row) : null;
}

export function upsertCoreSelf(
  db: Database.Database,
  content: string,
  tokenCount: number
): void {
  const timestamp = now();
  db.prepare(
    `UPDATE core_self SET content = ?, token_count = ?, updated_at = ? WHERE id = 1`
  ).run(content, tokenCount, timestamp);
}

// ============================================================================
// Long-Term Memory
// ============================================================================

export function insertLongTermMemory(
  db: Database.Database,
  data: {
    content: string;
    importance: number;
    memoryType: MemoryType;
    sourceType?: MemorySourceType | null;
    sourceId?: string | null;
    contactId?: string | null;
    keywords?: string[];
  }
): LongTermMemory {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO long_term_memories
       (id, content, importance, memory_type, source_type, source_id, contact_id, keywords, strength, created_at, last_accessed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    id,
    data.content,
    data.importance,
    data.memoryType,
    data.sourceType ?? null,
    data.sourceId ?? null,
    data.contactId ?? null,
    JSON.stringify(data.keywords ?? []),
    timestamp,
    timestamp,
    timestamp
  );
  return {
    id,
    content: data.content,
    importance: data.importance,
    memoryType: data.memoryType,
    sourceType: data.sourceType ?? null,
    sourceId: data.sourceId ?? null,
    contactId: data.contactId ?? null,
    keywords: data.keywords ?? [],
    strength: 1,
    createdAt: timestamp,
    lastAccessedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getLongTermMemory(
  db: Database.Database,
  id: string
): LongTermMemory | null {
  const row = db
    .prepare('SELECT * FROM long_term_memories WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const mem = snakeToCamel<LongTermMemory>(row);
  return {
    ...mem,
    keywords: typeof mem.keywords === 'string' ? JSON.parse(mem.keywords) : mem.keywords,
  };
}

export function searchLongTermMemories(
  db: Database.Database,
  opts: { contactId?: string; memoryType?: MemoryType; limit?: number }
): LongTermMemory[] {
  let sql = 'SELECT * FROM long_term_memories WHERE 1=1';
  const params: unknown[] = [];
  if (opts.contactId) {
    sql += ' AND contact_id = ?';
    params.push(opts.contactId);
  }
  if (opts.memoryType) {
    sql += ' AND memory_type = ?';
    params.push(opts.memoryType);
  }
  sql += ' ORDER BY importance DESC, last_accessed_at DESC LIMIT ?';
  params.push(opts.limit ?? 50);

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const mem = snakeToCamel<LongTermMemory>(row);
    return {
      ...mem,
      keywords: typeof mem.keywords === 'string' ? JSON.parse(mem.keywords) : mem.keywords,
    };
  });
}

export function updateMemoryAccess(db: Database.Database, id: string): void {
  db.prepare(
    'UPDATE long_term_memories SET strength = strength + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?'
  ).run(now(), now(), id);
}

export function listAllWorkingMemories(db: Database.Database): WorkingMemory[] {
  const rows = db
    .prepare('SELECT * FROM working_memory ORDER BY updated_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<WorkingMemory>(row));
}

export function pruneDecayedMemories(
  db: Database.Database,
  retentionThreshold: number = 0.1,
  importanceThreshold: number = 0.3
): number {
  // Prune memories that have decayed below threshold and are not important
  // retention < threshold AND importance < importanceThreshold
  // Since retention is computed in-app, we approximate by pruning old low-importance, low-strength memories
  const result = db
    .prepare(
      `DELETE FROM long_term_memories
       WHERE importance < ? AND strength <= 1
       AND last_accessed_at < datetime('now', '-30 days')`
    )
    .run(importanceThreshold);
  return result.changes;
}

// ============================================================================
// Observations (observational memory)
// ============================================================================

/**
 * Get observation for a stream. For messages, provide contactId.
 * For thoughts/experiences (global), contactId is omitted or null.
 */
export function getObservation(
  db: Database.Database,
  stream: StreamType,
  contactId?: string | null
): Observation | null {
  const row = contactId
    ? db
        .prepare('SELECT * FROM observations WHERE stream = ? AND contact_id = ?')
        .get(stream, contactId) as Record<string, unknown> | undefined
    : db
        .prepare('SELECT * FROM observations WHERE stream = ? AND contact_id IS NULL')
        .get(stream) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<Observation>(row) : null;
}

/**
 * Upsert observation content, token count, and watermark.
 * One row per stream per scope (global or per-contact).
 */
export function upsertObservation(
  db: Database.Database,
  data: {
    stream: StreamType;
    contactId?: string | null;
    content: string;
    tokenCount: number;
    lastRawId?: string | null;
    lastRawTimestamp?: string | null;
  }
): Observation {
  const timestamp = now();
  const contactId = data.contactId ?? null;
  const existing = getObservation(db, data.stream, contactId);

  if (existing) {
    db.prepare(
      `UPDATE observations SET content = ?, token_count = ?, last_raw_id = ?, last_raw_timestamp = ?, updated_at = ? WHERE id = ?`
    ).run(
      data.content,
      data.tokenCount,
      data.lastRawId ?? null,
      data.lastRawTimestamp ?? null,
      timestamp,
      existing.id
    );
    return getObservation(db, data.stream, contactId)!;
  }

  const id = generateUUID();
  db.prepare(
    `INSERT INTO observations (id, contact_id, stream, content, token_count, generation, last_raw_id, last_raw_timestamp, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    id,
    contactId,
    data.stream,
    data.content,
    data.tokenCount,
    data.lastRawId ?? null,
    data.lastRawTimestamp ?? null,
    timestamp,
    timestamp
  );
  return getObservation(db, data.stream, contactId)!;
}

/**
 * Update observation content and token count (for reflection).
 * Increments the generation counter.
 */
export function updateObservationContent(
  db: Database.Database,
  id: string,
  content: string,
  tokenCount: number,
  generation: number
): void {
  db.prepare(
    `UPDATE observations SET content = ?, token_count = ?, generation = ?, updated_at = ? WHERE id = ?`
  ).run(content, tokenCount, generation, now(), id);
}

/**
 * Delete observations. If contactId provided, deletes only that contact's observations.
 * If omitted, deletes all observations (for full reset).
 */
export function deleteObservations(
  db: Database.Database,
  contactId?: string | null
): number {
  if (contactId !== undefined && contactId !== null) {
    const result = db
      .prepare('DELETE FROM observations WHERE contact_id = ?')
      .run(contactId);
    return result.changes;
  }
  const result = db.prepare('DELETE FROM observations').run();
  return result.changes;
}

/**
 * Get all observations for a contact (messages stream).
 */
export function getContactObservations(
  db: Database.Database,
  contactId: string
): Observation[] {
  const rows = db
    .prepare('SELECT * FROM observations WHERE contact_id = ? ORDER BY updated_at DESC')
    .all(contactId) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Observation>(row));
}

/**
 * Get global observations (thoughts + experiences streams, contact_id IS NULL).
 */
export function getGlobalObservations(db: Database.Database): Observation[] {
  const rows = db
    .prepare('SELECT * FROM observations WHERE contact_id IS NULL ORDER BY stream ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Observation>(row));
}
