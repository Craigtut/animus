/**
 * manage_vault_entry Handler Tests
 *
 * Tests create, update, and delete actions with agent-only scoping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import type { ToolHandlerContext } from '../../src/tools/types.js';
import { createTestSystemDb, createTestAgentLogsDb } from '../helpers.js';
import { setDek, clearDek } from '../../src/lib/encryption-service.js';
import * as vaultStore from '../../src/db/stores/vault-store.js';

// Mock db/index to return our test DBs
let testDb: Database.Database;
let testAgentLogsDb: Database.Database;
vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => testDb,
  getAgentLogsDb: () => testAgentLogsDb,
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

import { manageVaultEntryHandler } from '../../src/tools/handlers/manage-vault-entry.js';

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

describe('manage_vault_entry handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestSystemDb();
    testAgentLogsDb = createTestAgentLogsDb();
    setDek(randomBytes(32));
  });

  afterEach(() => {
    clearDek();
  });

  describe('create action', () => {
    it('should create a vault entry with system-generated password', async () => {
      const result = await manageVaultEntryHandler(
        {
          action: 'create' as const,
          label: 'Test Account',
          service: 'test.com',
          identity: 'user@test.com',
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      const text = result.content[0]!.text;
      expect(text).toContain('Vault entry created');
      expect(text).toContain('Test Account');
      expect(text).toContain('test.com');
      expect(text).toContain('user@test.com');
      expect(text).toContain('vault:');
      expect(text).toContain('run_with_credentials');
    });

    it('should set createdBy to "agent"', async () => {
      await manageVaultEntryHandler(
        {
          action: 'create' as const,
          label: 'Agent Entry',
          service: 'agent-svc.com',
        },
        createMockContext(),
      );

      const entries = vaultStore.listVaultEntries(testDb);
      expect(entries.length).toBe(1);
      expect(entries[0]!.createdBy).toBe('agent');
    });

    it('should generate password with custom length', async () => {
      await manageVaultEntryHandler(
        {
          action: 'create' as const,
          label: 'Short PW',
          service: 'short.com',
          passwordLength: 16,
        },
        createMockContext(),
      );

      const entry = vaultStore.listVaultEntries(testDb)[0]!;
      // Verify password was created by checking the hint exists
      expect(entry.hint).toMatch(/^\*\*\*\*.{4}$/);
    });

    it('should warn about duplicate service entries', async () => {
      // Create a user entry first
      vaultStore.createVaultEntry(testDb, {
        label: 'Existing',
        service: 'github.com',
        password: 'existing-pw',
      });

      const result = await manageVaultEntryHandler(
        {
          action: 'create' as const,
          label: 'New GitHub',
          service: 'github.com',
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('1 other entry exists');
    });

    it('should include optional fields when provided', async () => {
      const result = await manageVaultEntryHandler(
        {
          action: 'create' as const,
          label: 'Full Entry',
          service: 'full.com',
          url: 'https://full.com/login',
          identity: 'admin@full.com',
          notes: 'Admin account',
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      const text = result.content[0]!.text;
      expect(text).toContain('https://full.com/login');
      expect(text).toContain('admin@full.com');
    });

    it('should write an audit log entry', async () => {
      await manageVaultEntryHandler(
        {
          action: 'create' as const,
          label: 'Audited',
          service: 'audit.com',
        },
        createMockContext(),
      );

      const logs = testAgentLogsDb
        .prepare('SELECT * FROM credential_access_log')
        .all() as Array<{ credential_ref: string; tool_name: string; agent_context: string }>;

      expect(logs.length).toBe(1);
      expect(logs[0]!.tool_name).toBe('manage_vault_entry');
      expect(logs[0]!.agent_context).toContain('Created vault entry');
    });
  });

  describe('update action', () => {
    let agentEntryId: string;

    beforeEach(() => {
      const entry = vaultStore.createVaultEntry(testDb, {
        label: 'Agent Entry',
        service: 'agent.com',
        identity: 'agent@agent.com',
        password: 'original-pw',
        createdBy: 'agent',
      });
      agentEntryId = entry.id;
    });

    it('should update metadata on agent-created entry', async () => {
      const result = await manageVaultEntryHandler(
        {
          action: 'update' as const,
          id: agentEntryId,
          label: 'Updated Label',
          identity: 'new@agent.com',
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      const text = result.content[0]!.text;
      expect(text).toContain('Updated Label');
      expect(text).toContain('new@agent.com');
    });

    it('should regenerate password when requested', async () => {
      const beforeEntry = vaultStore.getVaultEntry(testDb, agentEntryId)!;
      expect(beforeEntry.password).toBe('original-pw');

      const result = await manageVaultEntryHandler(
        {
          action: 'update' as const,
          id: agentEntryId,
          regeneratePassword: true,
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('password was regenerated');

      const afterEntry = vaultStore.getVaultEntry(testDb, agentEntryId)!;
      expect(afterEntry.password).not.toBe('original-pw');
      expect(afterEntry.password.length).toBe(32); // default length
    });

    it('should reject update on user-created entry', async () => {
      const userEntry = vaultStore.createVaultEntry(testDb, {
        label: 'User Entry',
        service: 'user.com',
        password: 'user-pw',
        // createdBy defaults to 'user'
      });

      const result = await manageVaultEntryHandler(
        {
          action: 'update' as const,
          id: userEntry.id,
          label: 'Hacked Label',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('created by the user');
    });

    it('should return error for non-existent entry', async () => {
      const result = await manageVaultEntryHandler(
        {
          action: 'update' as const,
          id: 'non-existent-id',
          label: 'No Such Entry',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
    });

    it('should write an audit log entry', async () => {
      await manageVaultEntryHandler(
        {
          action: 'update' as const,
          id: agentEntryId,
          label: 'Audited Update',
        },
        createMockContext(),
      );

      const logs = testAgentLogsDb
        .prepare('SELECT * FROM credential_access_log')
        .all() as Array<{ agent_context: string }>;

      expect(logs.length).toBe(1);
      expect(logs[0]!.agent_context).toContain('Updated vault entry');
    });
  });

  describe('delete action', () => {
    let agentEntryId: string;

    beforeEach(() => {
      const entry = vaultStore.createVaultEntry(testDb, {
        label: 'To Delete',
        service: 'delete.com',
        password: 'delete-me',
        createdBy: 'agent',
      });
      agentEntryId = entry.id;
    });

    it('should delete agent-created entry', async () => {
      const result = await manageVaultEntryHandler(
        { action: 'delete' as const, id: agentEntryId },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('deleted');
      expect(result.content[0]!.text).toContain('To Delete');

      // Verify it's gone
      const entry = vaultStore.getVaultEntryMetadata(testDb, agentEntryId);
      expect(entry).toBeNull();
    });

    it('should reject delete on user-created entry', async () => {
      const userEntry = vaultStore.createVaultEntry(testDb, {
        label: 'User Sacred',
        service: 'sacred.com',
        password: 'sacred-pw',
      });

      const result = await manageVaultEntryHandler(
        { action: 'delete' as const, id: userEntry.id },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('created by the user');

      // Verify it still exists
      const entry = vaultStore.getVaultEntryMetadata(testDb, userEntry.id);
      expect(entry).not.toBeNull();
    });

    it('should return error for non-existent entry', async () => {
      const result = await manageVaultEntryHandler(
        { action: 'delete' as const, id: 'ghost-id' },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
    });

    it('should write an audit log entry', async () => {
      await manageVaultEntryHandler(
        { action: 'delete' as const, id: agentEntryId },
        createMockContext(),
      );

      const logs = testAgentLogsDb
        .prepare('SELECT * FROM credential_access_log')
        .all() as Array<{ agent_context: string }>;

      expect(logs.length).toBe(1);
      expect(logs[0]!.agent_context).toContain('Deleted vault entry');
    });
  });
});
