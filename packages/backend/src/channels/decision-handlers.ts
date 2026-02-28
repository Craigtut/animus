/**
 * Channel Decision Handlers
 *
 * Registers handlers for channel-related decisions:
 * send_reaction.
 *
 * Extracted from decision-executor.ts executeChannelDecisions().
 */

import { registerDecisionHandler } from '../heartbeat/decision-registry.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ChannelDecisions', 'heartbeat');

// send_reaction
registerDecisionHandler('send_reaction', async (params, _decision, ctx) => {
  const emoji = String(params['emoji'] ?? '');
  if (!emoji || !ctx.triggerChannel) return;

  // Resolve external IDs from trigger metadata (channel adapters use different key names)
  const channelId = String(ctx.triggerMetadata?.['channelId'] ?? ctx.triggerMetadata?.['slackChannel'] ?? '');
  const messageId = String(ctx.triggerMetadata?.['messageId'] ?? ctx.triggerMetadata?.['slackTs'] ?? '');
  if (!channelId || !messageId) {
    log.warn('send_reaction: missing channelId or messageId in trigger metadata');
    return;
  }

  const ok = await ctx.channelManager.performAction(ctx.triggerChannel, {
    type: 'add_reaction',
    channelId,
    messageId,
    emoji,
  });
  if (!ok) {
    log.warn(`send_reaction failed for emoji ${emoji}`);
  }
});
