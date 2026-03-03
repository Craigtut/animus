/**
 * list_vault_entries Handler Tests
 *
 * Tests the vault entry listing tool handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import type { ToolHandlerContext } from '../../src/tools/types.js';
import { createTestSystemDb } from '../helpers.js';
import { setDek, clearDek } from '../../src/lib/encryption-service.js';
import * as vaultStore from '../../src/db/stores/vault-store.js';

// Mock db/index to return our test DB
let testDb: Database.Database;
vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => testDb,
}));

// Mock the logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { listVaultEntriesHandler } from '../../src/tools/handlers/list-vault-entries.js';

function createMockContext(): ToolHandlerContext {
  return {
    agentTaskId: 'task-1',
    contactId: 'contact-1',
    sourceChannel: 'web',
    conversationId: 'conv-1',
    stores: {
      messages: { createMessage: () => ({ id: 'msg-1' }) },
      heartbeat: {},
      memory: { retrieveRelevant: async () => [] },
    },
    eventBus: { on: () => {}, off: () => {}, emit: () => {}, once: () => {} },
  };
}

describe('list_vault_entries handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestSystemDb();
    setDek(randomBytes(32));
  });

  afterEach(() => {
    clearDek();
  });

  describe('empty vault', () => {
    it('should return helpful message when vault is empty', async () => {
      const result = await listVaultEntriesHandler({}, createMockContext());

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('vault is empty');
      expect(result.content[0]!.text).toContain('Settings > Passwords');
    });

    it('should return helpful message when filter matches nothing', async () => {
      vaultStore.createVaultEntry(testDb, {
        label: 'GitHub',
        service: 'github.com',
        password: 'pass123',
      });

      const result = await listVaultEntriesHandler(
        { service: 'nonexistent' },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('No vault entries found');
      expect(result.content[0]!.text).toContain('nonexistent');
    });
  });

  describe('populated vault', () => {
    beforeEach(() => {
      vaultStore.createVaultEntry(testDb, {
        label: 'GitHub',
        service: 'github.com',
        url: 'https://github.com',
        identity: 'user@example.com',
        password: 'gh-secret-pass',
        notes: 'Personal account',
      });
      vaultStore.createVaultEntry(testDb, {
        label: 'Gmail',
        service: 'google.com',
        identity: 'user@gmail.com',
        password: 'gmail-pass-1234',
      });
    });

    it('should list all entries with metadata', async () => {
      const result = await listVaultEntriesHandler({}, createMockContext());

      expect(result.isError).toBeFalsy();
      const text = result.content[0]!.text;
      expect(text).toContain('2 entries');
      expect(text).toContain('GitHub');
      expect(text).toContain('github.com');
      expect(text).toContain('user@example.com');
      expect(text).toContain('vault:');
      expect(text).toContain('password hint:');
      expect(text).toContain('Personal account');
    });

    it('should never include actual passwords', async () => {
      const result = await listVaultEntriesHandler({}, createMockContext());
      const text = result.content[0]!.text;

      expect(text).not.toContain('gh-secret-pass');
      expect(text).not.toContain('gmail-pass-1234');
    });

    it('should include vault refs for run_with_credentials usage', async () => {
      const result = await listVaultEntriesHandler({}, createMockContext());
      const text = result.content[0]!.text;

      expect(text).toContain('run_with_credentials');
      expect(text).toContain('vault:');
    });

    it('should filter by service name', async () => {
      const result = await listVaultEntriesHandler(
        { service: 'github' },
        createMockContext(),
      );

      const text = result.content[0]!.text;
      expect(text).toContain('1 entry');
      expect(text).toContain('GitHub');
      expect(text).not.toContain('Gmail');
    });

    it('should filter by label as well (case-insensitive)', async () => {
      const result = await listVaultEntriesHandler(
        { service: 'GMAIL' },
        createMockContext(),
      );

      const text = result.content[0]!.text;
      expect(text).toContain('1 entry');
      expect(text).toContain('Gmail');
    });
  });

  describe('single entry', () => {
    it('should use singular "entry" for count of 1', async () => {
      vaultStore.createVaultEntry(testDb, {
        label: 'Solo',
        service: 'solo.com',
        password: 'password',
      });

      const result = await listVaultEntriesHandler({}, createMockContext());
      expect(result.content[0]!.text).toContain('1 entry');
    });
  });
});
