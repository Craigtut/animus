/**
 * Discord Channel Adapter — STUB
 *
 * Placeholder for Discord.js bot integration.
 * Actual Discord integration deferred — needs bot token + testing.
 *
 * See docs/architecture/channels.md — "Discord Channel"
 */

import type { IChannelAdapter } from '../types.js';
import type { ChannelType } from '@animus/shared';

export class DiscordChannelAdapter implements IChannelAdapter {
  readonly channelType: ChannelType = 'discord';
  private enabled = false;

  /**
   * Start the Discord bot.
   * STUB: Logs but does not actually connect.
   */
  async start(): Promise<void> {
    // TODO: Initialize Discord.js Client with intents:
    //   - GatewayIntentBits.Guilds
    //   - GatewayIntentBits.GuildMessages
    //   - GatewayIntentBits.MessageContent (privileged)
    //   - GatewayIntentBits.DirectMessages
    // TODO: Set up Partials.Channel for DM support
    // TODO: Listen for 'messageCreate' events
    // TODO: Login with bot token from channel_configs

    this.enabled = true;
    console.log('[DiscordAdapter] Started (stub mode — no actual Discord connection)');
  }

  /**
   * Stop the Discord bot.
   * STUB: Logs but does not actually disconnect.
   */
  async stop(): Promise<void> {
    // TODO: client.destroy()
    this.enabled = false;
    console.log('[DiscordAdapter] Stopped');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a message to a Discord channel or DM.
   * STUB: Logs the action but does not actually send.
   */
  async send(
    contactId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const channelId = metadata?.channelId as string | undefined;
    // TODO: Look up Discord channel from contact_channels
    // TODO: Send via Discord.js:
    //   await channel.send(content);
    console.log(
      `[DiscordAdapter] Would send to contact ${contactId}${channelId ? ` (channel: ${channelId})` : ''}: "${content.substring(0, 50)}..."`
    );
  }
}
