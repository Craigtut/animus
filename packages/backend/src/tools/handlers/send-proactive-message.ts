/**
 * send_proactive_message handler — send to any contact on any channel.
 *
 * Mind-only tool. Goes through ChannelRouter.sendOutbound() for the full
 * delivery pipeline: adapter.send() -> message storage -> event emission.
 *
 * This is the first code path that actually calls ChannelRouter.sendOutbound().
 */

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { sendProactiveMessageDef } from '@animus-labs/shared';

type SendProactiveMessageInput = z.infer<typeof sendProactiveMessageDef.inputSchema>;

export const sendProactiveMessageHandler: ToolHandler<SendProactiveMessageInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // Guard: mind-only tool
  if (!context.stores.contacts || !context.stores.channels) {
    return {
      content: [
        {
          type: 'text',
          text: 'send_proactive_message is only available to the mind session.',
        },
      ],
      isError: true,
    };
  }

  // 1. Validate contact exists
  const contact = context.stores.contacts.getContact(input.contactId);
  if (!contact) {
    return {
      content: [
        {
          type: 'text',
          text: `Contact not found: ${input.contactId}. Use lookup_contacts to find valid contact IDs.`,
        },
      ],
      isError: true,
    };
  }

  // 2. Validate contact has the specified channel
  const channels = context.stores.contacts.getContactChannels(input.contactId);
  const hasChannel = channels.some((ch) => ch.channel === input.channel);
  if (!hasChannel) {
    const available = channels.map((ch) => ch.channel).join(', ') || 'none';
    return {
      content: [
        {
          type: 'text',
          text: `${contact.fullName} is not reachable via ${input.channel}. Available channels: ${available}.`,
        },
      ],
      isError: true,
    };
  }

  // 3. Send through the channel router
  const result = await context.stores.channels.sendOutbound({
    contactId: input.contactId,
    channel: input.channel,
    content: input.content,
    ...(input.media ? { media: input.media } : {}),
  });

  if (!result) {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to send message to ${contact.fullName} via ${input.channel}. The channel adapter may be disabled or encountered an error.`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Message sent to ${contact.fullName} via ${input.channel} (message ID: ${result.id}).`,
      },
    ],
  };
};
