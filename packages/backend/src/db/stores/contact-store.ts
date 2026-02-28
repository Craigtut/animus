/**
 * Contact Store — contacts and contact_channels tables
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { Contact, ContactChannel, ChannelType, PermissionTier } from '@animus-labs/shared';
import { snakeToCamel, boolToInt, intToBool } from '../utils.js';

interface NewContact {
  fullName: string;
  userId?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  isPrimary?: boolean;
  permissionTier?: PermissionTier;
  notes?: string | null;
}

function rowToContact(row: Record<string, unknown>): Contact {
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return { ...raw, isPrimary: intToBool(raw['isPrimary'] as number) } as Contact;
}

export function createContact(db: Database.Database, data: NewContact): Contact {
  const id = generateUUID();
  const timestamp = now();
  const isPrimary = data.isPrimary ?? false;
  const tier = data.permissionTier ?? (isPrimary ? 'primary' : 'standard');
  db.prepare(
    `INSERT INTO contacts (id, user_id, full_name, phone_number, email, is_primary, permission_tier, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.userId ?? null,
    data.fullName,
    data.phoneNumber ?? null,
    data.email ?? null,
    boolToInt(isPrimary),
    tier,
    data.notes ?? null,
    timestamp,
    timestamp
  );
  return {
    id,
    userId: data.userId ?? null,
    fullName: data.fullName,
    phoneNumber: data.phoneNumber ?? null,
    email: data.email ?? null,
    isPrimary,
    permissionTier: tier,
    notes: data.notes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getContact(db: Database.Database, id: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToContact(row) : null;
}

export function getContactByUserId(db: Database.Database, userId: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE user_id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToContact(row) : null;
}

export function getPrimaryContact(db: Database.Database): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE is_primary = 1 LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  return row ? rowToContact(row) : null;
}

export function listContacts(db: Database.Database): Contact[] {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY created_at').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(rowToContact);
}

export function updateContact(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Contact, 'fullName' | 'phoneNumber' | 'email' | 'notes' | 'permissionTier'>>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.fullName !== undefined) {
    fields.push('full_name = ?');
    values.push(data.fullName);
  }
  if (data.phoneNumber !== undefined) {
    fields.push('phone_number = ?');
    values.push(data.phoneNumber);
  }
  if (data.email !== undefined) {
    fields.push('email = ?');
    values.push(data.email);
  }
  if (data.notes !== undefined) {
    fields.push('notes = ?');
    values.push(data.notes);
  }
  if (data.permissionTier !== undefined) {
    fields.push('permission_tier = ?');
    values.push(data.permissionTier);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);
  db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================================================
// Contact Channels
// ============================================================================

export function createContactChannel(
  db: Database.Database,
  data: { contactId: string; channel: ChannelType; identifier: string; displayName?: string | null }
): ContactChannel {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO contact_channels (id, contact_id, channel, identifier, display_name, is_verified, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, data.contactId, data.channel, data.identifier, data.displayName ?? null, timestamp);
  return {
    id,
    contactId: data.contactId,
    channel: data.channel,
    identifier: data.identifier,
    displayName: data.displayName ?? null,
    isVerified: false,
    createdAt: timestamp,
  };
}

export function getContactChannelsByContactId(
  db: Database.Database,
  contactId: string
): ContactChannel[] {
  const rows = db
    .prepare('SELECT * FROM contact_channels WHERE contact_id = ?')
    .all(contactId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const raw = snakeToCamel<Record<string, unknown>>(row);
    return { ...raw, isVerified: intToBool(raw['isVerified'] as number) } as ContactChannel;
  });
}

export function resolveContactByChannel(
  db: Database.Database,
  channel: ChannelType,
  identifier: string
): Contact | null {
  const row = db
    .prepare(
      `SELECT c.* FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel = ? AND cc.identifier = ?`
    )
    .get(channel, identifier) as Record<string, unknown> | undefined;
  return row ? rowToContact(row) : null;
}

export function deleteContact(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteContactChannel(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM contact_channels WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Delete all contact_channels for a given channel type.
 * Used during channel uninstall to clean up identity mappings.
 */
export function deleteContactChannelsByChannel(db: Database.Database, channel: string): number {
  const result = db.prepare('DELETE FROM contact_channels WHERE channel = ?').run(channel);
  return result.changes;
}
