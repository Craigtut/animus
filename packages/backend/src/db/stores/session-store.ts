/**
 * Session Store
 *
 * CRUD over the mind_sessions table in sessions.db.
 * Each row represents a conversation thread keyed by (contact_id, channel).
 */

import type Database from 'better-sqlite3';

export interface MindSession {
  contactId: string;
  channel: string;
  conversationHistory: string | null;
  cortexObservationalState: string | null;
  contextTokenCount: number;
  createdAt: string;
  updatedAt: string;
}

interface MindSessionRow {
  contact_id: string;
  channel: string;
  conversation_history: string | null;
  cortex_observational_state: string | null;
  context_token_count: number;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: MindSessionRow): MindSession {
  return {
    contactId: row.contact_id,
    channel: row.channel,
    conversationHistory: row.conversation_history,
    cortexObservationalState: row.cortex_observational_state,
    contextTokenCount: row.context_token_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSession(
  db: Database.Database,
  contactId: string,
  channel: string,
): MindSession | null {
  const row = db
    .prepare(
      `SELECT contact_id, channel, conversation_history,
              cortex_observational_state, context_token_count,
              created_at, updated_at
       FROM mind_sessions
       WHERE contact_id = ? AND channel = ?`,
    )
    .get(contactId, channel) as MindSessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function upsertSession(
  db: Database.Database,
  contactId: string,
  channel: string,
  conversationHistory: string | null,
  cortexObservationalState: string | null,
  contextTokenCount: number,
): void {
  db.prepare(
    `INSERT INTO mind_sessions
       (contact_id, channel, conversation_history,
        cortex_observational_state, context_token_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (contact_id, channel) DO UPDATE SET
       conversation_history = excluded.conversation_history,
       cortex_observational_state = excluded.cortex_observational_state,
       context_token_count = excluded.context_token_count,
       updated_at = datetime('now')`,
  ).run(contactId, channel, conversationHistory, cortexObservationalState, contextTokenCount);
}

export function deleteSession(
  db: Database.Database,
  contactId: string,
  channel: string,
): void {
  db.prepare('DELETE FROM mind_sessions WHERE contact_id = ? AND channel = ?')
    .run(contactId, channel);
}

export function deleteAllSessions(db: Database.Database): void {
  db.exec('DELETE FROM mind_sessions');
}

export function listSessions(db: Database.Database): MindSession[] {
  const rows = db
    .prepare(
      `SELECT contact_id, channel, conversation_history,
              cortex_observational_state, context_token_count,
              created_at, updated_at
       FROM mind_sessions
       ORDER BY updated_at DESC`,
    )
    .all() as MindSessionRow[];
  return rows.map(rowToSession);
}
