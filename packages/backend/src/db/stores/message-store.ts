/**
 * Message Store — data access for messages.db
 *
 * Tables: conversations, messages, media_attachments
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  Conversation,
  Message,
  ChannelType,
  MessageDirection,
  StoredMediaAttachment as SharedStoredMediaAttachment,
} from '@animus-labs/shared';
import { snakeToCamel, intToBool } from '../utils.js';

// ============================================================================
// Conversations
// ============================================================================

function rowToConversation(row: Record<string, unknown>): Conversation {
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return { ...raw, isActive: intToBool(raw['isActive'] as number) } as Conversation;
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

/**
 * Attach media to an array of messages by batch-loading from media_attachments.
 */
function attachMedia(db: Database.Database, messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  const ids = messages.map((m) => m.id);
  const mediaMap = getMediaAttachmentsByMessageIds(db, ids);
  return messages.map((m) => {
    const attachments = mediaMap.get(m.id);
    return attachments ? { ...m, attachments } : m;
  });
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
    items: attachMedia(db, rows.map(rowToMessage)),
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
  return attachMedia(db, rows.map(rowToMessage));
}

/**
 * Get all messages since a given timestamp (exclusive), newest first.
 * Used by the observation pipeline to load all unsummarized items.
 */
export function getMessagesSince(
  db: Database.Database,
  conversationId: string,
  since: string,
  limit: number = 2000
): Message[] {
  const rows = db
    .prepare(
      'SELECT * FROM messages WHERE conversation_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(conversationId, since, limit) as Array<Record<string, unknown>>;
  return attachMedia(db, rows.map(rowToMessage));
}

export function getMessagesByContact(
  db: Database.Database,
  contactId: string,
  options: { limit?: number; since?: string; channel?: string; before?: string } = {}
): Message[] {
  const limit = options.limit ?? 50;
  const conditions = ['contact_id = ?'];
  const params: unknown[] = [contactId];

  if (options.since) {
    conditions.push('created_at >= ?');
    params.push(options.since);
  }

  if (options.channel) {
    conditions.push('channel = ?');
    params.push(options.channel);
  }

  if (options.before) {
    conditions.push('created_at < ?');
    params.push(options.before);
  }

  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params, limit) as Array<Record<string, unknown>>;
  return attachMedia(db, rows.map(rowToMessage));
}

// ============================================================================
// Media Attachments
// ============================================================================

export type StoredMediaAttachment = SharedStoredMediaAttachment;

function rowToAttachment(row: Record<string, unknown>): StoredMediaAttachment {
  return snakeToCamel<StoredMediaAttachment>(row);
}

export function getMediaAttachmentsByMessageIds(
  db: Database.Database,
  messageIds: string[]
): Map<string, StoredMediaAttachment[]> {
  const result = new Map<string, StoredMediaAttachment[]>();
  if (messageIds.length === 0) return result;

  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM media_attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
    )
    .all(...messageIds) as Array<Record<string, unknown>>;

  for (const row of rows) {
    const att = rowToAttachment(row);
    const existing = result.get(att.messageId);
    if (existing) {
      existing.push(att);
    } else {
      result.set(att.messageId, [att]);
    }
  }
  return result;
}

export function getMediaAttachment(
  db: Database.Database,
  id: string
): StoredMediaAttachment | null {
  const row = db
    .prepare('SELECT * FROM media_attachments WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToAttachment(row) : null;
}

export function createMediaAttachment(
  db: Database.Database,
  data: {
    messageId: string;
    type: 'image' | 'audio' | 'video' | 'file';
    mimeType: string;
    localPath: string;
    originalFilename: string | null;
    sizeBytes: number;
  }
): StoredMediaAttachment {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO media_attachments (id, message_id, type, mime_type, local_path, original_filename, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.messageId,
    data.type,
    data.mimeType,
    data.localPath,
    data.originalFilename,
    data.sizeBytes,
    timestamp
  );
  return {
    id,
    messageId: data.messageId,
    type: data.type,
    mimeType: data.mimeType,
    localPath: data.localPath,
    originalFilename: data.originalFilename,
    sizeBytes: data.sizeBytes,
    createdAt: timestamp,
    expiresAt: null,
  };
}

export function getLastMessageForContact(
  db: Database.Database,
  contactId: string
): Message | null {
  const row = db
    .prepare(
      'SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(contactId) as Record<string, unknown> | undefined;
  return row ? rowToMessage(row) : null;
}
