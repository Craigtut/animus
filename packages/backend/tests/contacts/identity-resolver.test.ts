import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../helpers.js';
import * as systemStore from '../../src/db/stores/system-store.js';

// Mock DB access
vi.mock('../../src/db/index.js', () => {
  let mockSysDb: Database.Database;
  return {
    getSystemDb: () => mockSysDb,
    getHeartbeatDb: vi.fn(),
    getMessagesDb: vi.fn(),
    _setMockSysDb: (db: Database.Database) => { mockSysDb = db; },
  };
});

const { resolveContact, resolveWebUser, createContactForChannel } = await import('../../src/contacts/identity-resolver.js');
const dbModule = await import('../../src/db/index.js') as unknown as { _setMockSysDb: (db: Database.Database) => void };

describe('identity-resolver', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
    dbModule._setMockSysDb(db);
  });

  describe('resolveContact', () => {
    it('returns null for unknown identifiers', () => {
      const result = resolveContact('sms', '+15551234567');
      expect(result).toBeNull();
    });

    it('resolves an existing contact by channel + identifier', () => {
      // Create a contact with a channel
      const contact = systemStore.createContact(db, {
        fullName: 'Test User',
        phoneNumber: '+15551234567',
      });
      systemStore.createContactChannel(db, {
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
      const contact = systemStore.createContact(db, {
        fullName: 'Discord User',
      });
      systemStore.createContactChannel(db, {
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

    it('resolves a web user to their contact', () => {
      const user = systemStore.createUser(db, {
        email: 'test@example.com',
        passwordHash: 'hash',
      });
      const contact = systemStore.createContact(db, {
        fullName: 'Web User',
        userId: user.id,
        isPrimary: true,
      });
      systemStore.updateUserContactId(db, user.id, contact.id);

      const resolved = resolveWebUser(user.id);
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
      const channels = systemStore.getContactChannelsByContactId(db, contact.id);
      expect(channels).toHaveLength(1);
      expect(channels[0]!.channel).toBe('sms');
      expect(channels[0]!.identifier).toBe('+15559876543');
    });
  });
});
