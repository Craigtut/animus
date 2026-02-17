/**
 * Contacts Router — tRPC procedures for contact management.
 *
 * CRUD operations for contacts and their channel identities.
 * Business logic delegated to ContactService.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getContactService } from '../../services/contact-service.js';
import { channelTypeSchema } from '@animus/shared';

export const contactsRouter = router({
  /**
   * Get the primary contact.
   */
  getPrimary: protectedProcedure.query(() => {
    return getContactService().getPrimaryContact();
  }),

  /**
   * Get a contact by ID.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => {
      return getContactService().getContact(input.id);
    }),

  /**
   * List all contacts, enriched with last message info.
   */
  list: protectedProcedure.query(() => {
    return getContactService().listContacts();
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
      return getContactService().createContact(input);
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
      const { id, ...data } = input;
      return getContactService().updateContact(id, data);
    }),

  /**
   * Delete a contact. Cannot delete the primary contact.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      getContactService().deleteContact(input.id);
      return { success: true };
    }),

  /**
   * Get channels for a contact.
   */
  getChannels: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(({ input }) => {
      return getContactService().getChannels(input.contactId);
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
      return getContactService().addChannel(input);
    }),

  /**
   * Remove a channel from a contact.
   */
  removeChannel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      getContactService().removeChannel(input.id);
      return { success: true };
    }),
});
