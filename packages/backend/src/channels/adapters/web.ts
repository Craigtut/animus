/**
 * Web Channel Adapter
 *
 * Handles messages from the web UI via tRPC.
 * Always active — cannot be disabled.
 *
 * See docs/architecture/channels.md — "Web Channel"
 */

import type { IChannelAdapter } from '../types.js';
import type { ChannelType } from '@animus/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('WebAdapter', 'channels');

export class WebChannelAdapter implements IChannelAdapter {
  readonly channelType: ChannelType = 'web';
  private enabled = true;

  async start(): Promise<void> {
    this.enabled = true;
    // Web channel is always active via tRPC — no external connections needed
  }

  async stop(): Promise<void> {
    // Web channel cannot be disabled
    // No-op: it stays active as long as the server runs
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send an outbound message to a web user.
   * Currently just stores in DB — the tRPC subscription pushes to the client.
   */
  async send(
    contactId: string,
    content: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    // Web outbound is handled by the heartbeat pipeline:
    // - EXECUTE stores the reply in messages.db
    // - EventBus emits 'message:sent'
    // - tRPC subscription delivers to the frontend
    // This method is a no-op because the pipeline handles it directly.
    log.info(
      `Outbound to ${contactId}: ${content.substring(0, 50)}...`
    );
  }
}
