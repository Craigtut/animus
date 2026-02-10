/**
 * Identity Resolver
 *
 * Resolves a channel + identifier pair to a Contact record.
 * Creates unknown-tier contacts for unrecognized identifiers.
 *
 * See docs/architecture/contacts.md — "Identity Resolution"
 */

import { getSystemDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import type { Contact, ChannelType, ResolvedContact } from '@animus/shared';

// ============================================================================
// Identity Resolution
// ============================================================================

export interface ResolveResult {
  contact: Contact;
  isNew: boolean;
}

/**
 * Resolve a contact from a channel and identifier.
 *
 * 1. Look up contact_channels for matching (channel, identifier)
 * 2. If found, return the associated contact
 * 3. If not found, create a new contact with unknown tier + channel link
 */
export function resolveContact(
  channel: ChannelType,
  identifier: string
): ResolveResult | null {
  const db = getSystemDb();

  // Step 1: Look up existing contact by channel + identifier
  const existing = systemStore.resolveContactByChannel(db, channel, identifier);
  if (existing) {
    return { contact: existing, isNew: false };
  }

  // Step 2: No match — this is an unknown caller
  // Per docs: unknown callers get a canned response and do NOT trigger a tick.
  // Return null to indicate unknown caller.
  return null;
}

/**
 * Resolve a contact and return a ResolvedContact for the channel adapter.
 * Returns null for unknown callers.
 */
export function resolveToResolvedContact(
  channel: ChannelType,
  identifier: string
): ResolvedContact | null {
  const result = resolveContact(channel, identifier);
  if (!result) return null;

  return {
    id: result.contact.id,
    fullName: result.contact.fullName,
    permissionTier: result.contact.permissionTier,
  };
}

/**
 * Resolve a web user to their contact.
 * Web users are resolved via the users.contact_id FK,
 * not via contact_channels lookup.
 */
export function resolveWebUser(userId: string): Contact | null {
  const db = getSystemDb();
  return systemStore.getContactByUserId(db, userId);
}

/**
 * Create a contact for a new external identifier (admin action).
 * Used when the primary user adds a new contact through the UI.
 */
export function createContactForChannel(
  channel: ChannelType,
  identifier: string,
  fullName: string,
  options?: { phoneNumber?: string; email?: string }
): Contact {
  const db = getSystemDb();

  // Create the contact
  const contact = systemStore.createContact(db, {
    fullName,
    phoneNumber: options?.phoneNumber ?? null,
    email: options?.email ?? null,
    isPrimary: false,
    permissionTier: 'standard',
  });

  // Link the channel
  systemStore.createContactChannel(db, {
    contactId: contact.id,
    channel,
    identifier,
  });

  return contact;
}
