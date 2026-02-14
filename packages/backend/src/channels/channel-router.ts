/**
 * Channel Router
 *
 * Central message routing: receives inbound messages from any channel,
 * resolves identity, checks permissions, stores messages, and queues ticks.
 * Outbound delivery is delegated to ChannelManager.
 *
 * See docs/architecture/channel-packages.md — "Outbound Routing"
 */

import { getMessagesDb, getSystemDb } from '../db/index.js';
import * as messageStore from '../db/stores/message-store.js';
import * as systemStore from '../db/stores/system-store.js';
import { resolveContact } from '../contacts/identity-resolver.js';
import { canPerformByTier } from '../contacts/permission-enforcer.js';
import { handleIncomingMessage } from '../heartbeat/index.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { getChannelManager } from './channel-manager.js';
import type { ChannelType, Contact, Message, PermissionTier } from '@animus/shared';

const log = createLogger('ChannelRouter', 'channels');

// ============================================================================
// Channel Router
// ============================================================================

export class ChannelRouter {
  /**
   * Handle an incoming message from any channel.
   *
   * 1. Resolve contact via identity resolver
   * 2. Check permissions
   * 3. Store message in messages.db
   * 4. Queue a message tick trigger
   * 5. Return the stored message (or null for unknown callers)
   */
  handleIncoming(params: {
    channel: ChannelType;
    identifier: string;
    content: string;
    conversationId?: string;
    media?: Array<{
      type: 'image' | 'audio' | 'video' | 'file';
      mimeType: string;
      url: string;
      filename?: string;
    }>;
    metadata?: Record<string, unknown>;
  }): Message | null {
    const { channel, identifier, content, conversationId, media, metadata } = params;

    // Combine metadata with external conversationId and media attachments
    const combinedMetadata = {
      ...metadata,
      ...(conversationId ? { externalConversationId: conversationId } : {}),
      ...(media && media.length > 0 ? { media } : {}),
    };

    // Step 1: Resolve contact
    const resolved = resolveContact(channel, identifier);
    if (!resolved) {
      // Unknown caller — send canned response, notify primary
      this.handleUnknownCaller(channel, identifier, content);
      return null;
    }

    const { contact } = resolved;
    const tier: PermissionTier = contact.isPrimary
      ? 'primary'
      : contact.permissionTier;

    // Step 2: Check permissions
    if (!canPerformByTier(tier, 'trigger_tick')) {
      log.warn(
        `Contact ${contact.id} (${tier}) cannot trigger ticks`
      );
      return null;
    }

    // Step 3: Store message
    const msgDb = getMessagesDb();
    let conv = messageStore.getActiveConversation(msgDb, contact.id, channel);
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId: contact.id,
        channel,
      });
    }

    const msg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId: contact.id,
      direction: 'inbound',
      channel,
      content,
      metadata: combinedMetadata,
    });

    // Step 4: Emit event and trigger tick
    getEventBus().emit('message:received', msg);

    const hasMetadata = Object.keys(combinedMetadata).length > 0;
    handleIncomingMessage({
      contactId: contact.id,
      contactName: contact.fullName,
      channel,
      content,
      messageId: msg.id,
      conversationId: conv.id,
      ...(hasMetadata ? { metadata: combinedMetadata } : {}),
    });

    return msg;
  }

  /**
   * Send an outbound message — stores in messages.db and delivers via ChannelManager.
   */
  async sendOutbound(params: {
    contactId: string;
    channel: ChannelType;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message | null> {
    const { contactId, channel, content, metadata } = params;

    // Store outbound message first (even if delivery fails, the message is persisted)
    const msgDb = getMessagesDb();
    let conv = messageStore.getActiveConversation(msgDb, contactId, channel);
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId,
        channel,
      });
    }

    const msg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId,
      direction: 'outbound',
      channel,
      content,
      ...(metadata ? { metadata } : {}),
    });

    getEventBus().emit('message:sent', msg);

    // Deliver via ChannelManager (handles both built-in and package channels)
    const channelManager = getChannelManager();
    try {
      const delivered = await channelManager.sendToChannel(channel, contactId, content, metadata);
      if (!delivered) {
        log.warn(`Message stored but delivery failed for channel ${channel}`);
      }
    } catch (err) {
      log.error(`Failed to deliver via ${channel}:`, err);
      // Message is already stored — don't crash, per docs: don't auto-retry
    }

    return msg;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private handleUnknownCaller(
    channel: ChannelType,
    identifier: string,
    content: string
  ): void {
    log.info(
      `Unknown caller on ${channel}: ${identifier}`
    );

    // Notify primary contact
    const sysDb = getSystemDb();
    const primary = systemStore.getPrimaryContact(sysDb);
    if (primary) {
      const preview =
        content.length > 100 ? content.substring(0, 100) + '...' : content;
      log.info(
        `Would notify primary: Unknown message from ${identifier} on ${channel}: "${preview}"`
      );
      // TODO: Send notification to primary contact when notification system is built
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let router: ChannelRouter | null = null;

export function getChannelRouter(): ChannelRouter {
  if (!router) {
    router = new ChannelRouter();
  }
  return router;
}
