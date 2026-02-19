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
import { getMessageService } from '../../services/message-service.js';
import { consumePendingUpload } from '../routes/media.js';
import { channelTypeSchema, paginationInputSchema, generateUUID, now } from '@animus/shared';
import type { Message } from '@animus/shared';

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

      // Link pending uploads as media attachments
      const attachments: import('@animus/shared').StoredMediaAttachment[] = [];
      if (input.attachmentIds && input.attachmentIds.length > 0) {
        for (const uploadId of input.attachmentIds) {
          const pending = consumePendingUpload(uploadId);
          if (!pending) continue; // Skip expired or missing uploads

          const att = messageStore.createMediaAttachment(msgDb, {
            messageId: msg.id,
            type: pending.type,
            mimeType: pending.mimeType,
            localPath: pending.localPath,
            originalFilename: pending.originalFilename,
            sizeBytes: pending.sizeBytes,
          });
          attachments.push(att);
        }
      }

      const result: Message = attachments.length > 0
        ? { ...msg, attachments }
        : msg;

      // Emit message received event
      getEventBus().emit('message:received', result);

      // Trigger heartbeat tick for this message
      const metadata: Record<string, unknown> | undefined = attachments.length > 0
        ? {
            media: attachments.map((a) => ({
              type: a.type,
              mimeType: a.mimeType,
              localPath: a.localPath,
              originalFilename: a.originalFilename,
            })),
          }
        : undefined;

      handleIncomingMessage({
        contactId: contact.id,
        contactName: contact.fullName,
        channel: input.channel,
        content: input.content,
        messageId: msg.id,
        conversationId: conv.id,
        ...(metadata ? { metadata } : {}),
      });

      return result;
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
