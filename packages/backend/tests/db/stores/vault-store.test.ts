/**
 * Vault Store Tests
 *
 * Tests CRUD operations for the password vault, including
 * encrypt/decrypt, hint generation, and metadata-only reads.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createTestSystemDb } from '../../helpers.js';
import { setDek, clearDek } from '../../../src/lib/encryption-service.js';
import {
  createVaultEntry,
  getVaultEntry,
  getVaultEntryMetadata,
  updateVaultEntry,
  deleteVaultEntry,
  listVaultEntries,
  getVaultEntryCount,
} from '../../../src/db/stores/vault-store.js';

describe('vault-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
    setDek(randomBytes(32));
  });

  afterEach(() => {
    clearDek();
  });

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  describe('createVaultEntry', () => {
    it('should create a vault entry and return metadata', () => {
      const result = createVaultEntry(db, {
        label: 'GitHub',
        service: 'github.com',
        url: 'https://github.com',
        identity: 'user@example.com',
        password: 'my-secret-password',
        notes: 'Personal account',
      });

      expect(result.id).toBeTruthy();
      expect(result.label).toBe('GitHub');
      expect(result.service).toBe('github.com');
      expect(result.url).toBe('https://github.com');
      expect(result.identity).toBe('user@example.com');
      expect(result.hint).toBe('****word');
      expect(result.notes).toBe('Personal account');
      expect(result.createdAt).toBeTruthy();
      expect(result.updatedAt).toBeTruthy();
    });

    it('should create entry with minimal fields', () => {
      const result = createVaultEntry(db, {
        label: 'Test Service',
        service: 'test.com',
        password: 'abc',
      });

      expect(result.id).toBeTruthy();
      expect(result.label).toBe('Test Service');
      expect(result.url).toBeNull();
      expect(result.identity).toBeNull();
      expect(result.notes).toBeNull();
    });

    it('should generate hint as last 4 chars of password', () => {
      const result = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'abcdefghijklmnop',
      });

      expect(result.hint).toBe('****mnop');
    });

    it('should generate masked hint for short passwords', () => {
      const result = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'ab',
      });

      expect(result.hint).toBe('****');
    });

    it('should encrypt the password at rest', () => {
      createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'plaintext-secret',
      });

      // Read raw from DB to verify encryption
      const row = db.prepare('SELECT encrypted_password FROM vault_entries').get() as {
        encrypted_password: string;
      };
      expect(row.encrypted_password).not.toBe('plaintext-secret');
      expect(row.encrypted_password.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  describe('getVaultEntry', () => {
    it('should return entry with decrypted password', () => {
      const created = createVaultEntry(db, {
        label: 'GitHub',
        service: 'github.com',
        password: 'my-secret-password',
      });

      const entry = getVaultEntry(db, created.id);
      expect(entry).not.toBeNull();
      expect(entry!.password).toBe('my-secret-password');
      expect(entry!.label).toBe('GitHub');
    });

    it('should return null for nonexistent ID', () => {
      const entry = getVaultEntry(db, 'nonexistent-id');
      expect(entry).toBeNull();
    });
  });

  describe('getVaultEntryMetadata', () => {
    it('should return metadata with hint but no password', () => {
      const created = createVaultEntry(db, {
        label: 'GitHub',
        service: 'github.com',
        password: 'my-secret-password',
      });

      const meta = getVaultEntryMetadata(db, created.id);
      expect(meta).not.toBeNull();
      expect(meta!.hint).toBe('****word');
      // Metadata should NOT have a password property
      expect('password' in meta!).toBe(false);
    });

    it('should return null for nonexistent ID', () => {
      const meta = getVaultEntryMetadata(db, 'nonexistent-id');
      expect(meta).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  describe('listVaultEntries', () => {
    it('should return empty array when no entries', () => {
      const entries = listVaultEntries(db);
      expect(entries).toHaveLength(0);
    });

    it('should return all entries as metadata', () => {
      createVaultEntry(db, { label: 'GitHub', service: 'github.com', password: 'pass1' });
      createVaultEntry(db, { label: 'Gmail', service: 'google.com', password: 'pass2' });
      createVaultEntry(db, { label: 'AWS', service: 'aws.amazon.com', password: 'pass3' });

      const entries = listVaultEntries(db);
      expect(entries).toHaveLength(3);

      // Should be sorted by service, label
      expect(entries[0]!.service).toBe('aws.amazon.com');
      expect(entries[1]!.service).toBe('github.com');
      expect(entries[2]!.service).toBe('google.com');

      // Should have hints, not passwords
      for (const entry of entries) {
        expect(entry.hint).toBeTruthy();
        expect('password' in entry).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Count
  // --------------------------------------------------------------------------

  describe('getVaultEntryCount', () => {
    it('should return 0 for empty vault', () => {
      expect(getVaultEntryCount(db)).toBe(0);
    });

    it('should return correct count', () => {
      createVaultEntry(db, { label: 'A', service: 'a.com', password: 'pass' });
      createVaultEntry(db, { label: 'B', service: 'b.com', password: 'pass' });
      expect(getVaultEntryCount(db)).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  describe('updateVaultEntry', () => {
    it('should update label and service', () => {
      const created = createVaultEntry(db, {
        label: 'Old Label',
        service: 'old.com',
        password: 'password123',
      });

      const updated = updateVaultEntry(db, created.id, {
        label: 'New Label',
        service: 'new.com',
      });

      expect(updated).not.toBeNull();
      expect(updated!.label).toBe('New Label');
      expect(updated!.service).toBe('new.com');
    });

    it('should update password and reflect in hint', () => {
      const created = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'old-password',
      });

      updateVaultEntry(db, created.id, { password: 'new-password-here' });

      // Verify password changed
      const entry = getVaultEntry(db, created.id);
      expect(entry!.password).toBe('new-password-here');

      // Verify hint updated
      const meta = getVaultEntryMetadata(db, created.id);
      expect(meta!.hint).toBe('****here');
    });

    it('should update identity and url', () => {
      const created = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'pass',
      });

      const updated = updateVaultEntry(db, created.id, {
        identity: 'user@test.com',
        url: 'https://test.com/login',
      });

      expect(updated!.identity).toBe('user@test.com');
      expect(updated!.url).toBe('https://test.com/login');
    });

    it('should allow setting fields to null', () => {
      const created = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        url: 'https://test.com',
        identity: 'user@test.com',
        password: 'pass',
        notes: 'Some notes',
      });

      const updated = updateVaultEntry(db, created.id, {
        url: null,
        identity: null,
        notes: null,
      });

      expect(updated!.url).toBeNull();
      expect(updated!.identity).toBeNull();
      expect(updated!.notes).toBeNull();
    });

    it('should return null for nonexistent ID', () => {
      const result = updateVaultEntry(db, 'nonexistent', { label: 'Test' });
      expect(result).toBeNull();
    });

    it('should update updated_at timestamp', () => {
      const created = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'pass',
      });

      // Manually backdate created_at so the update timestamp is guaranteed different
      db.prepare(
        "UPDATE vault_entries SET created_at = '2020-01-01T00:00:00.000Z', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
      ).run(created.id);

      updateVaultEntry(db, created.id, { label: 'Updated' });

      const updated = getVaultEntryMetadata(db, created.id);
      expect(updated!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });
  });

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  describe('deleteVaultEntry', () => {
    it('should delete an existing entry', () => {
      const created = createVaultEntry(db, {
        label: 'Test',
        service: 'test.com',
        password: 'pass',
      });

      const deleted = deleteVaultEntry(db, created.id);
      expect(deleted).toBe(true);

      const entry = getVaultEntry(db, created.id);
      expect(entry).toBeNull();
    });

    it('should return false for nonexistent ID', () => {
      const deleted = deleteVaultEntry(db, 'nonexistent-id');
      expect(deleted).toBe(false);
    });

    it('should not affect other entries', () => {
      const a = createVaultEntry(db, { label: 'A', service: 'a.com', password: 'pass' });
      createVaultEntry(db, { label: 'B', service: 'b.com', password: 'pass' });

      deleteVaultEntry(db, a.id);

      const entries = listVaultEntries(db);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.label).toBe('B');
    });
  });
});
