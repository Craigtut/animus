/**
 * Message Service — read operations for conversations and messages.
 *
 * Message CREATION stays in the channel router (sendOutbound/handleIncoming)
 * as those are the authoritative write paths. This service handles reads only.
 */

import { getMessagesDb, getSystemDb } from '../db/index.js';
import * as messageStore from '../db/stores/message-store.js';
import * as systemStore from '../db/stores/system-store.js';
import type { Conversation, Message } from '@animus/shared';

// ============================================================================
// Types
// ============================================================================

export interface PaginatedMessages {
  items: Message[];
  total: number;
}

export interface MessagesByContactOptions {
  limit?: number | undefined;
  channel?: string | undefined;
  before?: string | undefined;
}

// ============================================================================
// Service
// ============================================================================

class MessageService {
  /**
   * Get paginated messages for a conversation.
   */
  getMessages(conversationId: string, opts?: { page?: number | undefined; pageSize?: number | undefined }): PaginatedMessages {
    const storeOpts: { page?: number; pageSize?: number } = {};
    if (opts?.page !== undefined) storeOpts.page = opts.page;
    if (opts?.pageSize !== undefined) storeOpts.pageSize = opts.pageSize;
    return messageStore.getMessages(getMessagesDb(), conversationId, storeOpts);
  }

  /**
   * Get the active conversation for a user's contact on a given channel.
   * Returns null if the user has no contact or no active conversation.
   */
  getActiveConversation(userId: string, channel: string): Conversation | null {
    const sysDb = getSystemDb();
    const msgDb = getMessagesDb();

    const user = systemStore.getUserById(sysDb, userId);
    if (!user?.contactId) return null;

    return messageStore.getActiveConversation(
      msgDb,
      user.contactId,
      channel as Message['channel']
    );
  }

  /**
   * Get recent messages for a user's active conversation on a given channel.
   * Returns empty array if no contact or no active conversation.
   */
  getRecentMessages(userId: string, channel: string, limit: number = 50): Message[] {
    const sysDb = getSystemDb();
    const msgDb = getMessagesDb();

    const user = systemStore.getUserById(sysDb, userId);
    if (!user?.contactId) return [];

    const conv = messageStore.getActiveConversation(
      msgDb,
      user.contactId,
      channel as Message['channel']
    );
    if (!conv) return [];

    return messageStore.getRecentMessages(msgDb, conv.id, limit);
  }

  /**
   * Get messages for a specific contact with optional channel filter and cursor pagination.
   */
  getMessagesByContact(contactId: string, opts?: MessagesByContactOptions): Message[] {
    const storeOpts: { limit?: number; channel?: string; before?: string } = {};
    if (opts?.limit !== undefined) storeOpts.limit = opts.limit;
    if (opts?.channel !== undefined) storeOpts.channel = opts.channel;
    if (opts?.before !== undefined) storeOpts.before = opts.before;
    return messageStore.getMessagesByContact(getMessagesDb(), contactId, storeOpts);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: MessageService | null = null;

export function getMessageService(): MessageService {
  if (!instance) instance = new MessageService();
  return instance;
}
