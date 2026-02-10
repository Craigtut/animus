/**
 * Contacts Router — tRPC procedures for contact management.
 *
 * CRUD operations for contacts and their channel identities.
 * List queries enriched with last-message data from messages.db.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb, getMessagesDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as messageStore from '../../db/stores/message-store.js';
import { channelTypeSchema } from '@animus/shared';

export const contactsRouter = router({
  /**
   * Get the primary contact.
   */
  getPrimary: protectedProcedure.query(() => {
    return systemStore.getPrimaryContact(getSystemDb());
  }),

  /**
   * Get a contact by ID.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => {
      const contact = systemStore.getContact(getSystemDb(), input.id);
      if (!contact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      }
      return contact;
    }),

  /**
   * List all contacts, enriched with last message info.
   */
  list: protectedProcedure.query(() => {
    const sysDb = getSystemDb();
    const msgDb = getMessagesDb();
    const contacts = systemStore.listContacts(sysDb);

    return contacts.map((contact) => {
      const lastMessage = messageStore.getLastMessageForContact(msgDb, contact.id);
      return {
        ...contact,
        lastMessage: lastMessage
          ? {
              content: lastMessage.content,
              direction: lastMessage.direction,
              createdAt: lastMessage.createdAt,
              channel: lastMessage.channel,
            }
          : null,
      };
    });
  }),

  /**
   * Create a new contact.
   */
  create: protectedProcedure
    .input(
      z.object({
        fullName: z.string().min(1),
        phoneNumber: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      return systemStore.createContact(getSystemDb(), {
        fullName: input.fullName,
        phoneNumber: input.phoneNumber ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
      });
    }),

  /**
   * Update a contact.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        fullName: z.string().min(1).optional(),
        phoneNumber: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getSystemDb();
      const existing = systemStore.getContact(db, input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      }
      // Build update object, only including defined properties
      const updateData: Parameters<typeof systemStore.updateContact>[2] = {};
      if (input.fullName !== undefined) updateData.fullName = input.fullName;
      if (input.phoneNumber !== undefined) updateData.phoneNumber = input.phoneNumber;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.notes !== undefined) updateData.notes = input.notes;
      systemStore.updateContact(db, input.id, updateData);
      return systemStore.getContact(db, input.id)!;
    }),

  /**
   * Delete a contact. Cannot delete the primary contact.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      const db = getSystemDb();
      const contact = systemStore.getContact(db, input.id);
      if (!contact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      }
      if (contact.isPrimary) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot delete the primary contact',
        });
      }
      systemStore.deleteContact(db, input.id);
      return { success: true };
    }),

  /**
   * Get channels for a contact.
   */
  getChannels: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(({ input }) => {
      return systemStore.getContactChannelsByContactId(getSystemDb(), input.contactId);
    }),

  /**
   * Add a channel to a contact.
   */
  addChannel: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        channel: channelTypeSchema,
        identifier: z.string().min(1),
        displayName: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getSystemDb();
      const contact = systemStore.getContact(db, input.contactId);
      if (!contact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      }
      return systemStore.createContactChannel(db, {
        contactId: input.contactId,
        channel: input.channel,
        identifier: input.identifier,
        displayName: input.displayName ?? null,
      });
    }),

  /**
   * Remove a channel from a contact.
   */
  removeChannel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      const deleted = systemStore.deleteContactChannel(getSystemDb(), input.id);
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }
      return { success: true };
    }),
});
