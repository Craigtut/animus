/**
 * Message Store — data access for messages.db
 *
 * Tables: conversations, messages, media_attachments
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus/shared';
import type {
  Conversation,
  Message,
  ChannelType,
  MessageDirection,
} from '@animus/shared';
import { snakeToCamel, intToBool } from '../utils.js';

// ============================================================================
// Conversations
// ============================================================================

function rowToConversation(row: Record<string, unknown>): Conversation {
  const c = snakeToCamel<Conversation & { isActive: number }>(row);
  return { ...c, isActive: intToBool(c.isActive as unknown as number) };
}

export function createConversation(
  db: Database.Database,
  data: { contactId: string; channel: ChannelType }
): Conversation {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO conversations (id, contact_id, channel, started_at, last_message_at, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(id, data.contactId, data.channel, timestamp, timestamp);
  return {
    id,
    contactId: data.contactId,
    channel: data.channel,
    startedAt: timestamp,
    lastMessageAt: timestamp,
    isActive: true,
  };
}

export function getConversation(
  db: Database.Database,
  id: string
): Conversation | null {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToConversation(row) : null;
}

export function getConversationByContactAndChannel(
  db: Database.Database,
  contactId: string,
  channel: ChannelType
): Conversation | null {
  const row = db
    .prepare(
      'SELECT * FROM conversations WHERE contact_id = ? AND channel = ? AND is_active = 1 ORDER BY started_at DESC LIMIT 1'
    )
    .get(contactId, channel) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

export function getActiveConversation(
  db: Database.Database,
  contactId: string,
  channel: ChannelType
): Conversation | null {
  return getConversationByContactAndChannel(db, contactId, channel);
}

// ============================================================================
// Messages
// ============================================================================

export function createMessage(
  db: Database.Database,
  data: {
    conversationId: string;
    contactId: string;
    direction: MessageDirection;
    channel: ChannelType;
    content: string;
    metadata?: Record<string, unknown> | null;
    tickNumber?: number | null;
  }
): Message {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, contact_id, direction, channel, content, metadata, tick_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.conversationId,
    data.contactId,
    data.direction,
    data.channel,
    data.content,
    data.metadata ? JSON.stringify(data.metadata) : null,
    data.tickNumber ?? null,
    timestamp
  );

  // Update conversation last_message_at
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(
    timestamp,
    data.conversationId
  );

  return {
    id,
    conversationId: data.conversationId,
    contactId: data.contactId,
    direction: data.direction,
    channel: data.channel,
    content: data.content,
    metadata: data.metadata ?? null,
    tickNumber: data.tickNumber ?? null,
    createdAt: timestamp,
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  const m = snakeToCamel<Message>(row);
  return {
    ...m,
    metadata: typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata,
  };
}

export function getMessages(
  db: Database.Database,
  conversationId: string,
  opts: { page?: number; pageSize?: number } = {}
): { items: Message[]; total: number } {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const countRow = db
    .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
    .get(conversationId) as { count: number };

  const rows = db
    .prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    )
    .all(conversationId, pageSize, offset) as Array<Record<string, unknown>>;

  return {
    items: rows.map(rowToMessage),
    total: countRow.count,
  };
}

export function getRecentMessages(
  db: Database.Database,
  conversationId: string,
  limit: number = 20
): Message[] {
  const rows = db
    .prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(conversationId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToMessage);
}
