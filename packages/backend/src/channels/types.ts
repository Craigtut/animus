/**
 * Channel adapter types.
 *
 * See docs/architecture/channels.md — "Adapter Interface"
 */

import type { FastifyInstance } from 'fastify';
import type { ChannelType } from '@animus/shared';

/**
 * Common interface for all channel adapters.
 */
export interface IChannelAdapter {
  readonly channelType: ChannelType;

  /** Start the adapter (connect bot, register routes, etc.) */
  start(): Promise<void>;

  /** Stop the adapter (disconnect bot, unregister routes, etc.) */
  stop(): Promise<void>;

  /** Whether the adapter is currently running */
  isEnabled(): boolean;

  /** Send an outbound message to a contact */
  send(
    contactId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /** Register Fastify routes (for webhook/API channels) */
  registerRoutes?(fastify: FastifyInstance): Promise<void>;
}
