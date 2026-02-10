/**
 * send_message handler — sends a message to the triggering contact.
 *
 * Used by sub-agents for progress updates, clarifying questions,
 * or intermediate findings.
 */

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { sendMessageDef } from '@animus/shared';

type SendMessageInput = z.infer<typeof sendMessageDef.inputSchema>;

export const sendMessageHandler: ToolHandler<SendMessageInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // 1. Write message to messages.db
  const msg = context.stores.messages.createMessage({
    conversationId: context.conversationId,
    contactId: context.contactId,
    direction: 'outbound',
    channel: context.sourceChannel,
    content: input.content,
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
