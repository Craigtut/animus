/**
 * Messages Router - tRPC procedures for conversations and messages.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getEventBus } from '../../lib/event-bus.js';
import { getMessageService } from '../../services/message-service.js';
import { channelTypeSchema } from '@animus-labs/shared';
import type { Message } from '@animus-labs/shared';

export const messagesRouter = router({
  /**
   * Send a message from the user (primary contact).
   * Writes to messages.db immediately, then triggers a heartbeat tick.
   * Optional attachmentIds[] links pre-uploaded media files to the message.
   */
  send: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(10000),
      channel: channelTypeSchema.default('web'),
      attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    }))
    .mutation(({ input, ctx }) => {
      return getMessageService().sendMessage(
        ctx.userId,
        input.content,
        input.channel,
        input.attachmentIds,
      );
    }),

  /**
   * Get messages for a conversation.
   */
  list: protectedProcedure
    .input(z.object({
      conversationId: z.string().uuid(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(20),
    }))
    .query(({ input }) => {
      return getMessageService().getMessages(input.conversationId, {
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  /**
   * Get conversations for the current user's contact.
   */
  getConversation: protectedProcedure
    .input(z.object({
      channel: channelTypeSchema.default('web'),
    }))
    .query(({ input, ctx }) => {
      return getMessageService().getActiveConversation(ctx.userId, input.channel);
    }),

  /**
   * Get recent messages for the current user's active web conversation.
   */
  getRecent: protectedProcedure
    .input(z.object({
      limit: z.number().int().positive().max(100).default(50),
      channel: channelTypeSchema.default('web'),
    }).optional())
    .query(({ input, ctx }) => {
      const channel = input?.channel ?? 'web';
      return getMessageService().getRecentMessages(ctx.userId, channel, input?.limit ?? 50);
    }),

  /**
   * Get messages for a specific contact with optional channel filter and cursor pagination.
   */
  getByContact: protectedProcedure
    .input(z.object({
      contactId: z.string().uuid(),
      limit: z.number().int().positive().max(200).default(50),
      channel: z.string().min(1).optional(),
      before: z.string().optional(),
    }))
    .query(({ input }) => {
      const { contactId, ...opts } = input;
      return getMessageService().getMessagesByContact(contactId, opts);
    }),

  /**
   * Subscribe to new messages (real-time).
   */
  onMessage: protectedProcedure.subscription(() => {
    return observable<Message>((emit) => {
      const eventBus = getEventBus();

      const onReceived = (msg: Message) => emit.next(msg);
      const onSent = (msg: Message) => emit.next(msg);

      eventBus.on('message:received', onReceived);
      eventBus.on('message:sent', onSent);

      return () => {
        eventBus.off('message:received', onReceived);
        eventBus.off('message:sent', onSent);
      };
    });
  }),
});
