/**
 * send_message handler — sends a message to the triggering contact.
 *
 * Used by sub-agents for progress updates, clarifying questions,
 * or intermediate findings.
 */

import type { z } from 'zod/v3';
import type { ToolHandler, ToolResult } from '../types.js';
import { sendMessageDef } from '@animus-labs/shared';

type SendMessageInput = z.infer<typeof sendMessageDef.inputSchema>;

export const sendMessageHandler: ToolHandler<SendMessageInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // For external channels with media, route through the channel router for full delivery
  if (input.media && input.media.length > 0 && context.stores.channels) {
    const result = await context.stores.channels.sendOutbound({
      contactId: context.contactId,
      channel: context.sourceChannel as import('@animus-labs/shared').ChannelType,
      content: input.content,
      media: input.media,
    });

    if (!result) {
      return {
        content: [{ type: 'text', text: `Failed to send message with media via ${context.sourceChannel}.` }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: `Message with ${input.media.length} attachment(s) sent to ${context.sourceChannel} channel.` }],
    };
  }

  // 1. Write message to messages.db
  // Web messages are delivered instantly via event bus, no retry needed.
  const msg = context.stores.messages.createMessage({
    conversationId: context.conversationId,
    contactId: context.contactId,
    direction: 'outbound',
    channel: context.sourceChannel,
    content: input.content,
    deliveryStatus: 'sent',
  });

  // 2. Emit real-time event for frontend (tRPC subscription)
  context.eventBus.emit('message:sent', {
    id: msg.id,
    conversationId: context.conversationId,
    contactId: context.contactId,
    direction: 'outbound' as const,
    channel: context.sourceChannel as 'web',
    content: input.content,
    metadata: null,
    tickNumber: null,
    createdAt: new Date().toISOString(),
  });

  return {
    content: [
      {
        type: 'text',
        text: `Message sent successfully to ${context.sourceChannel} channel.`,
      },
    ],
  };
};
