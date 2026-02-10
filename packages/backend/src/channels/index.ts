/**
 * Channels Module — barrel export
 *
 * Provides channel routing, adapters, and types.
 * See docs/architecture/channels.md
 */

export { ChannelRouter, getChannelRouter } from './channel-router.js';
export type { IChannelAdapter } from './types.js';

// Adapters
export { WebChannelAdapter } from './adapters/web.js';
export { SmsChannelAdapter } from './adapters/sms.js';
export { DiscordChannelAdapter } from './adapters/discord.js';
export { ApiChannelAdapter } from './adapters/api.js';
