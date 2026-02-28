/**
 * Message Service - conversations and messages (reads + user send).
 *
 * Handles reads (pagination, recent, by-contact) and the user-initiated
 * send path (contact resolution, conversation creation, attachment linking,
 * event emission, heartbeat trigger).
 */

import { createLogger } from '../lib/logger.js';
import { getMessagesDb, getSystemDb } from '../db/index.js';
import * as messageStore from '../db/stores/message-store.js';
import * as systemStore from '../db/stores/system-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { handleIncomingMessage } from '../heartbeat/index.js';
import { consumePendingUpload } from '../api/routes/media.js';
import type { Conversation, Message, ChannelType, StoredMediaAttachment } from '@animus-labs/shared';

const log = createLogger('MessageService', 'server');

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

  /**
   * Send a message from the user (primary contact).
   * Writes to messages.db, links attachments, emits event, triggers heartbeat tick.
   */
  sendMessage(
    userId: string,
    content: string,
    channel: ChannelType,
    attachmentIds?: string[],
  ): Message {
    const sysDb = getSystemDb();
    const msgDb = getMessagesDb();

    // Resolve the user's contact
    const user = systemStore.getUserById(sysDb, userId);
    if (!user?.contactId) {
      throw new Error('User has no associated contact');
    }
    const contact = systemStore.getContact(sysDb, user.contactId);
    if (!contact) {
      throw new Error('Contact not found');
    }

    // Get or create conversation
    let conv = messageStore.getActiveConversation(msgDb, contact.id, channel);
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId: contact.id,
        channel,
      });
    }

    // Write message to messages.db immediately (before tick processing)
    const msg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId: contact.id,
      direction: 'inbound',
      channel,
      content,
    });

    // Link pending uploads as media attachments
    const attachments: StoredMediaAttachment[] = [];
    if (attachmentIds && attachmentIds.length > 0) {
      for (const uploadId of attachmentIds) {
        const pending = consumePendingUpload(uploadId);
        if (!pending) continue; // Skip expired or missing uploads

        const att = messageStore.createMediaAttachment(msgDb, {
          messageId: msg.id,
          type: pending.type,
          mimeType: pending.mimeType,
          localPath: pending.localPath,
          originalFilename: pending.originalFilename,
          sizeBytes: pending.sizeBytes,
        });
        attachments.push(att);
      }
    }

    const result: Message = attachments.length > 0
      ? { ...msg, attachments }
      : msg;

    // Emit message received event
    getEventBus().emit('message:received', result);

    // Trigger heartbeat tick for this message
    const metadata: Record<string, unknown> | undefined = attachments.length > 0
      ? {
          media: attachments.map((a) => ({
            type: a.type,
            mimeType: a.mimeType,
            localPath: a.localPath,
            originalFilename: a.originalFilename,
          })),
        }
      : undefined;

    handleIncomingMessage({
      contactId: contact.id,
      contactName: contact.fullName,
      channel,
      content,
      messageId: msg.id,
      conversationId: conv.id,
      ...(metadata ? { metadata } : {}),
    });

    return result;
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
