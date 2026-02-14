/**
 * Channels Module — barrel export
 *
 * Provides channel routing, channel manager, and process hosting.
 * See docs/architecture/channel-packages.md
 */

export { ChannelRouter, getChannelRouter } from './channel-router.js';
export { ChannelManager, getChannelManager } from './channel-manager.js';
export { ChannelProcessHost } from './process-host.js';
