import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestContactsDb } from '../helpers.js';
import * as contactStore from '../../src/db/stores/contact-store.js';

// Mock DB access — identity-resolver now uses getContactsDb() for contact operations
vi.mock('../../src/db/index.js', () => {
  let mockContactsDb: Database.Database;
  return {
    getContactsDb: () => mockContactsDb,
    getSystemDb: vi.fn(),
    getHeartbeatDb: vi.fn(),
    getMessagesDb: vi.fn(),
    _setMockContactsDb: (db: Database.Database) => { mockContactsDb = db; },
  };
});

const { resolveContact, resolveWebUser, createContactForChannel } = await import('../../src/contacts/identity-resolver.js');
const dbModule = await import('../../src/db/index.js') as unknown as { _setMockContactsDb: (db: Database.Database) => void };

describe('identity-resolver', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestContactsDb();
    dbModule._setMockContactsDb(db);
  });

  describe('resolveContact', () => {
    it('returns null for unknown identifiers', () => {
      const result = resolveContact('sms', '+15551234567');
      expect(result).toBeNull();
    });

    it('resolves an existing contact by channel + identifier', () => {
      // Create a contact with a channel
      const contact = contactStore.createContact(db, {
        fullName: 'Test User',
        phoneNumber: '+15551234567',
      });
      contactStore.createContactChannel(db, {
        contactId: contact.id,
        channel: 'sms',
        identifier: '+15551234567',
      });

      const result = resolveContact('sms', '+15551234567');
      expect(result).not.toBeNull();
      expect(result!.contact.id).toBe(contact.id);
      expect(result!.isNew).toBe(false);
    });

    it('does not match across different channels', () => {
      const contact = contactStore.createContact(db, {
        fullName: 'Discord User',
      });
      contactStore.createContactChannel(db, {
        contactId: contact.id,
        channel: 'discord',
        identifier: '123456789',
      });

      // Looking up with SMS should not find the Discord contact
      const result = resolveContact('sms', '123456789');
      expect(result).toBeNull();
    });
  });

  describe('resolveWebUser', () => {
    it('returns null for unknown user', () => {
      const result = resolveWebUser('nonexistent-user');
      expect(result).toBeNull();
    });

    it('resolves a web user to their contact via userId', () => {
      const userId = 'test-user-id';
      const contact = contactStore.createContact(db, {
        fullName: 'Web User',
        userId,
        isPrimary: true,
      });

      const resolved = resolveWebUser(userId);
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(contact.id);
      expect(resolved!.fullName).toBe('Web User');
    });
  });

  describe('createContactForChannel', () => {
    it('creates a new standard contact with channel link', () => {
      const contact = createContactForChannel('sms', '+15559876543', 'Mom');
      expect(contact.fullName).toBe('Mom');
      expect(contact.isPrimary).toBe(false);
      expect(contact.permissionTier).toBe('standard');

      // Verify channel was linked
      const channels = contactStore.getContactChannelsByContactId(db, contact.id);
      expect(channels).toHaveLength(1);
      expect(channels[0]!.channel).toBe('sms');
      expect(channels[0]!.identifier).toBe('+15559876543');
    });
  });
});
