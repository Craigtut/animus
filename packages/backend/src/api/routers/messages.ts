/**
 * Messages Router — tRPC procedures for conversations and messages.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getMessagesDb, getSystemDb } from '../../db/index.js';
import * as messageStore from '../../db/stores/message-store.js';
import * as systemStore from '../../db/stores/system-store.js';
import { handleIncomingMessage } from '../../heartbeat/index.js';
import { getEventBus } from '../../lib/event-bus.js';
import { channelTypeSchema, paginationInputSchema, generateUUID, now } from '@animus/shared';
import type { Message } from '@animus/shared';

export const messagesRouter = router({
  /**
   * Send a message from the user (primary contact).
   * Writes to messages.db immediately, then triggers a heartbeat tick.
   */
  send: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(10000),
      channel: channelTypeSchema.default('web'),
    }))
    .mutation(({ input, ctx }) => {
      const sysDb = getSystemDb();
      const msgDb = getMessagesDb();

      // Resolve the user's contact
      const user = systemStore.getUserById(sysDb, ctx.userId);
      if (!user?.contactId) {
        throw new Error('User has no associated contact');
      }
      const contact = systemStore.getContact(sysDb, user.contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      // Get or create conversation
      let conv = messageStore.getActiveConversation(msgDb, contact.id, input.channel);
      if (!conv) {
        conv = messageStore.createConversation(msgDb, {
          contactId: contact.id,
          channel: input.channel,
        });
      }

      // Write message to messages.db immediately (before tick processing)
      const msg = messageStore.createMessage(msgDb, {
        conversationId: conv.id,
        contactId: contact.id,
        direction: 'inbound',
        channel: input.channel,
        content: input.content,
      });

      // Emit message received event
      getEventBus().emit('message:received', msg);

      // Trigger heartbeat tick for this message
      handleIncomingMessage({
        contactId: contact.id,
        contactName: contact.fullName,
        channel: input.channel,
        content: input.content,
        messageId: msg.id,
        conversationId: conv.id,
      });

      return msg;
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
      const db = getMessagesDb();
      return messageStore.getMessages(db, input.conversationId, {
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
      const sysDb = getSystemDb();
      const msgDb = getMessagesDb();

      const user = systemStore.getUserById(sysDb, ctx.userId);
      if (!user?.contactId) return null;

      return messageStore.getActiveConversation(msgDb, user.contactId, input.channel);
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
      const sysDb = getSystemDb();
      const msgDb = getMessagesDb();

      const user = systemStore.getUserById(sysDb, ctx.userId);
      if (!user?.contactId) return [];

      const channel = input?.channel ?? 'web';
      const conv = messageStore.getActiveConversation(msgDb, user.contactId, channel);
      if (!conv) return [];

      return messageStore.getRecentMessages(msgDb, conv.id, input?.limit ?? 50);
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
