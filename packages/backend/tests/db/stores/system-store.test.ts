import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../../helpers.js';
import * as systemStore from '../../../src/db/stores/system-store.js';

describe('system-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  // ========================================================================
  // Users
  // ========================================================================

  describe('users', () => {
    it('creates a user and retrieves by email', () => {
      const user = systemStore.createUser(db, {
        email: 'test@example.com',
        passwordHash: 'hashed',
      });
      expect(user.email).toBe('test@example.com');
      expect(user.id).toBeDefined();

      const found = systemStore.getUserByEmail(db, 'test@example.com');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(user.id);
    });

    it('retrieves user by ID', () => {
      const user = systemStore.createUser(db, {
        email: 'test@example.com',
        passwordHash: 'hashed',
      });
      const found = systemStore.getUserById(db, user.id);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('test@example.com');
    });

    it('returns null for nonexistent user', () => {
      expect(systemStore.getUserByEmail(db, 'nope@example.com')).toBeNull();
      expect(systemStore.getUserById(db, 'nonexistent-id')).toBeNull();
    });

    it('counts users', () => {
      expect(systemStore.getUserCount(db)).toBe(0);
      systemStore.createUser(db, { email: 'a@b.com', passwordHash: 'h' });
      expect(systemStore.getUserCount(db)).toBe(1);
    });

    it('retrieves password hash', () => {
      systemStore.createUser(db, { email: 'a@b.com', passwordHash: 'my-hash' });
      expect(systemStore.getPasswordHash(db, 'a@b.com')).toBe('my-hash');
      expect(systemStore.getPasswordHash(db, 'nope@b.com')).toBeNull();
    });
  });

  // ========================================================================
  // Contacts
  // ========================================================================

  describe('contacts', () => {
    it('creates and retrieves a contact', () => {
      const contact = systemStore.createContact(db, {
        fullName: 'John Doe',
        email: 'john@example.com',
        isPrimary: true,
      });
      expect(contact.fullName).toBe('John Doe');
      expect(contact.isPrimary).toBe(true);
      expect(contact.permissionTier).toBe('primary');

      const found = systemStore.getContact(db, contact.id);
      expect(found).not.toBeNull();
      expect(found!.fullName).toBe('John Doe');
      expect(found!.isPrimary).toBe(true);
    });

    it('lists all contacts', () => {
      systemStore.createContact(db, { fullName: 'Alice' });
      systemStore.createContact(db, { fullName: 'Bob' });
      const contacts = systemStore.listContacts(db);
      expect(contacts).toHaveLength(2);
    });

    it('gets primary contact', () => {
      systemStore.createContact(db, { fullName: 'Standard User' });
      systemStore.createContact(db, { fullName: 'Primary User', isPrimary: true });
      const primary = systemStore.getPrimaryContact(db);
      expect(primary).not.toBeNull();
      expect(primary!.fullName).toBe('Primary User');
    });

    it('updates a contact', () => {
      const contact = systemStore.createContact(db, { fullName: 'Old Name' });
      systemStore.updateContact(db, contact.id, { fullName: 'New Name' });
      const updated = systemStore.getContact(db, contact.id);
      expect(updated!.fullName).toBe('New Name');
    });

    it('gets contact by user ID', () => {
      const user = systemStore.createUser(db, { email: 'u@b.com', passwordHash: 'h' });
      const contact = systemStore.createContact(db, {
        fullName: 'Test',
        userId: user.id,
      });
      const found = systemStore.getContactByUserId(db, user.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(contact.id);
    });
  });

  // ========================================================================
  // Contact Channels
  // ========================================================================

  describe('contact channels', () => {
    it('creates and retrieves channels', () => {
      const contact = systemStore.createContact(db, { fullName: 'Test' });
      systemStore.createContactChannel(db, {
        contactId: contact.id,
        channel: 'web',
        identifier: 'test@example.com',
      });
      const channels = systemStore.getContactChannelsByContactId(db, contact.id);
      expect(channels).toHaveLength(1);
      expect(channels[0]!.channel).toBe('web');
    });

    it('resolves contact by channel', () => {
      const contact = systemStore.createContact(db, { fullName: 'Test' });
      systemStore.createContactChannel(db, {
        contactId: contact.id,
        channel: 'sms',
        identifier: '+15551234567',
      });
      const resolved = systemStore.resolveContactByChannel(db, 'sms', '+15551234567');
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(contact.id);
    });

    it('returns null for unresolvable channel', () => {
      const resolved = systemStore.resolveContactByChannel(db, 'web', 'nonexistent');
      expect(resolved).toBeNull();
    });
  });

  // ========================================================================
  // Settings
  // ========================================================================

  describe('system settings', () => {
    it('returns default settings', () => {
      const settings = systemStore.getSystemSettings(db);
      expect(settings.heartbeatIntervalMs).toBe(300000);
      expect(settings.defaultAgentProvider).toBe('claude');
      expect(settings.goalApprovalMode).toBe('always_approve');
    });

    it('updates settings', () => {
      systemStore.updateSystemSettings(db, { heartbeatIntervalMs: 60000 });
      const settings = systemStore.getSystemSettings(db);
      expect(settings.heartbeatIntervalMs).toBe(60000);
    });
  });

  describe('personality settings', () => {
    it('returns default personality', () => {
      const ps = systemStore.getPersonalitySettings(db);
      expect(ps.name).toBe('Animus');
      expect(ps.traits).toEqual([]);
    });

    it('updates personality', () => {
      systemStore.updatePersonalitySettings(db, {
        name: 'Atlas',
        traits: ['curious', 'empathetic'],
      });
      const ps = systemStore.getPersonalitySettings(db);
      expect(ps.name).toBe('Atlas');
      expect(ps.traits).toEqual(['curious', 'empathetic']);
    });
  });

  // ========================================================================
  // API Keys
  // ========================================================================

  describe('api keys', () => {
    it('sets and gets an API key', () => {
      systemStore.setApiKey(db, 'anthropic', 'encrypted-value');
      expect(systemStore.getApiKey(db, 'anthropic')).toBe('encrypted-value');
    });

    it('updates existing key', () => {
      systemStore.setApiKey(db, 'anthropic', 'old-value');
      systemStore.setApiKey(db, 'anthropic', 'new-value');
      expect(systemStore.getApiKey(db, 'anthropic')).toBe('new-value');
    });

    it('returns null for missing key', () => {
      expect(systemStore.getApiKey(db, 'nonexistent')).toBeNull();
    });
  });
});
