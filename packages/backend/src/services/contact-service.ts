/**
 * Contact Service — business logic for contact management.
 *
 * Encapsulates contact CRUD, channel management, and cross-DB cascade operations.
 * The router layer handles auth and input validation; this layer owns the logic.
 */

import { TRPCError } from '@trpc/server';
import { createLogger } from '../lib/logger.js';
import { getContactsDb, getMessagesDb } from '../db/index.js';
import * as contactStore from '../db/stores/contact-store.js';
import * as messageStore from '../db/stores/message-store.js';
import type { Contact, ContactChannel, ChannelType, Message } from '@animus-labs/shared';

const log = createLogger('ContactService', 'server');

// ============================================================================
// Types
// ============================================================================

export interface ContactWithLastMessage extends Contact {
  channels: Array<{
    id: string;
    channel: ChannelType;
    identifier: string;
    isVerified: boolean;
  }>;
  lastMessage: {
    content: string;
    direction: Message['direction'];
    createdAt: string;
    channel: ChannelType;
  } | null;
}

export interface CreateContactInput {
  fullName: string;
  phoneNumber?: string | null | undefined;
  email?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateContactInput {
  fullName?: string | undefined;
  phoneNumber?: string | null | undefined;
  email?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface AddChannelInput {
  contactId: string;
  channel: ChannelType;
  identifier: string;
  displayName?: string | null | undefined;
}

// ============================================================================
// Service
// ============================================================================

class ContactService {
  /**
   * List all contacts, enriched with channel info and last message.
   */
  listContacts(): ContactWithLastMessage[] {
    const cDb = getContactsDb();
    const msgDb = getMessagesDb();
    const contacts = contactStore.listContacts(cDb);

    return contacts.map((contact) => {
      const lastMessage = messageStore.getLastMessageForContact(msgDb, contact.id);
      const channels = contactStore.getContactChannelsByContactId(cDb, contact.id);
      return {
        ...contact,
        channels: channels.map((ch) => ({
          id: ch.id,
          channel: ch.channel,
          identifier: ch.identifier,
          isVerified: ch.isVerified,
        })),
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
  }

  /**
   * Get the primary contact.
   */
  getPrimaryContact(): Contact | null {
    return contactStore.getPrimaryContact(getContactsDb());
  }

  /**
   * Get a contact by ID. Throws NOT_FOUND if missing.
   */
  getContact(id: string): Contact {
    const contact = contactStore.getContact(getContactsDb(), id);
    if (!contact) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
    }
    return contact;
  }

  /**
   * Create a new contact.
   */
  createContact(data: CreateContactInput): Contact {
    return contactStore.createContact(getContactsDb(), {
      fullName: data.fullName,
      phoneNumber: data.phoneNumber ?? null,
      email: data.email ?? null,
      notes: data.notes ?? null,
    });
  }

  /**
   * Update a contact. Throws NOT_FOUND if missing.
   */
  updateContact(id: string, data: UpdateContactInput): Contact {
    const db = getContactsDb();
    const existing = contactStore.getContact(db, id);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
    }

    const updateData: Parameters<typeof contactStore.updateContact>[2] = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.phoneNumber !== undefined) updateData.phoneNumber = data.phoneNumber;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.notes !== undefined) updateData.notes = data.notes;

    contactStore.updateContact(db, id, updateData);
    return contactStore.getContact(db, id)!;
  }

  /**
   * Delete a contact. Cannot delete the primary contact.
   * Cascades: removes contact channels from contacts.db.
   * (Messages and memory are preserved as historical data.)
   */
  deleteContact(id: string): void {
    const db = getContactsDb();
    const contact = contactStore.getContact(db, id);
    if (!contact) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
    }
    if (contact.isPrimary) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot delete the primary contact',
      });
    }

    contactStore.deleteContact(db, id);
    log.info(`Deleted contact ${id} (${contact.fullName})`);
  }

  /**
   * Get channels for a contact.
   */
  getChannels(contactId: string): ContactChannel[] {
    return contactStore.getContactChannelsByContactId(getContactsDb(), contactId);
  }

  /**
   * Add a channel to a contact. Throws NOT_FOUND if contact missing.
   */
  addChannel(data: AddChannelInput): ContactChannel {
    const db = getContactsDb();
    const contact = contactStore.getContact(db, data.contactId);
    if (!contact) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
    }
    return contactStore.createContactChannel(db, {
      contactId: data.contactId,
      channel: data.channel,
      identifier: data.identifier,
      displayName: data.displayName ?? null,
    });
  }

  /**
   * Remove a channel. Throws NOT_FOUND if channel missing.
   */
  removeChannel(channelId: string): void {
    const deleted = contactStore.deleteContactChannel(getContactsDb(), channelId);
    if (!deleted) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ContactService | null = null;

export function getContactService(): ContactService {
  if (!instance) instance = new ContactService();
  return instance;
}
