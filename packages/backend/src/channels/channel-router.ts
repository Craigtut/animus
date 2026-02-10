/**
 * Channel Router
 *
 * Central message routing: receives inbound messages from any channel,
 * resolves identity, checks permissions, stores messages, and queues ticks.
 *
 * See docs/architecture/channels.md — "Outbound Routing"
 */

import { getMessagesDb, getSystemDb } from '../db/index.js';
import * as messageStore from '../db/stores/message-store.js';
import * as systemStore from '../db/stores/system-store.js';
import { resolveContact } from '../contacts/identity-resolver.js';
import { canPerformByTier } from '../contacts/permission-enforcer.js';
import { handleIncomingMessage } from '../heartbeat/index.js';
import { getEventBus } from '../lib/event-bus.js';
import type { ChannelType, Contact, Message, PermissionTier } from '@animus/shared';
import type { IChannelAdapter } from './types.js';

// ============================================================================
// Channel Router
// ============================================================================

export class ChannelRouter {
  private adapters = new Map<ChannelType, IChannelAdapter>();

  /**
   * Register a channel adapter.
   */
  registerAdapter(adapter: IChannelAdapter): void {
    this.adapters.set(adapter.channelType, adapter);
  }

  /**
   * Get a registered adapter by channel type.
   */
  getAdapter(channel: ChannelType): IChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

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
    metadata?: Record<string, unknown>;
  }): Message | null {
    const { channel, identifier, content, metadata } = params;

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
      console.warn(
        `[ChannelRouter] Contact ${contact.id} (${tier}) cannot trigger ticks`
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
      metadata,
    });

    // Step 4: Emit event and trigger tick
    getEventBus().emit('message:received', msg);

    handleIncomingMessage({
      contactId: contact.id,
      contactName: contact.fullName,
      channel,
      content,
      messageId: msg.id,
      conversationId: conv.id,
    });

    return msg;
  }

  /**
   * Send an outbound message through the appropriate channel adapter.
   */
  async sendOutbound(params: {
    contactId: string;
    channel: ChannelType;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message | null> {
    const { contactId, channel, content, metadata } = params;

    const adapter = this.adapters.get(channel);
    if (!adapter) {
      console.error(`[ChannelRouter] No adapter for channel: ${channel}`);
      return null;
    }

    if (!adapter.isEnabled()) {
      console.error(
        `[ChannelRouter] Channel ${channel} is disabled, cannot send`
      );
      return null;
    }

    // Send via adapter
    try {
      await adapter.send(contactId, content, metadata);
    } catch (err) {
      console.error(
        `[ChannelRouter] Failed to send via ${channel}:`,
        err
      );
      // Log failure but don't crash — per docs, don't auto-retry
      return null;
    }

    // Store outbound message
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
      metadata,
    });

    getEventBus().emit('message:sent', msg);
    return msg;
  }

  /**
   * Start all registered adapters.
   */
  async startAll(): Promise<void> {
    for (const [channelType, adapter] of this.adapters) {
      try {
        await adapter.start();
        console.log(`[ChannelRouter] Started adapter: ${channelType}`);
      } catch (err) {
        console.error(
          `[ChannelRouter] Failed to start adapter ${channelType}:`,
          err
        );
        // Continue — don't let one adapter failure block others
      }
    }
  }

  /**
   * Stop all registered adapters.
   */
  async stopAll(): Promise<void> {
    for (const [channelType, adapter] of this.adapters) {
      try {
        await adapter.stop();
        console.log(`[ChannelRouter] Stopped adapter: ${channelType}`);
      } catch (err) {
        console.error(
          `[ChannelRouter] Failed to stop adapter ${channelType}:`,
          err
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private handleUnknownCaller(
    channel: ChannelType,
    identifier: string,
    content: string
  ): void {
    console.log(
      `[ChannelRouter] Unknown caller on ${channel}: ${identifier}`
    );

    // Notify primary contact
    const sysDb = getSystemDb();
    const primary = systemStore.getPrimaryContact(sysDb);
    if (primary) {
      const preview =
        content.length > 100 ? content.substring(0, 100) + '...' : content;
      console.log(
        `[ChannelRouter] Would notify primary: Unknown message from ${identifier} on ${channel}: "${preview}"`
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
