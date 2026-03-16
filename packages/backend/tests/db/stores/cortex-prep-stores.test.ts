/**
 * Tests for Phase 0 cortex prep store additions:
 * - heartbeat-state-store: conversation_history column
 * - settings-store: cortex settings columns
 * - credential-store: cortex credential helpers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb, createTestSystemDb } from '../../helpers.js';
import * as heartbeatStateStore from '../../../src/db/stores/heartbeat-state-store.js';
import * as settingsStore from '../../../src/db/stores/settings-store.js';

// Credential store needs encryption mocked
vi.mock('../../../src/lib/encryption-service.js', () => ({
  encrypt: (data: string) => `enc:${data}`,
  decrypt: (data: string) => data.replace(/^enc:/, ''),
}));

// Must import credential store AFTER mocking encryption
const credentialStore = await import('../../../src/db/stores/credential-store.js');

// ============================================================================
// 0.1: conversation_history column
// ============================================================================

describe('heartbeat-state-store: conversation_history', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('returns null when no conversation history has been set', () => {
    const history = heartbeatStateStore.getConversationHistory(db);
    expect(history).toBeNull();
  });

  it('stores and retrieves conversation history', () => {
    const messages = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);

    heartbeatStateStore.updateConversationHistory(db, messages);
    const result = heartbeatStateStore.getConversationHistory(db);
    expect(result).toBe(messages);

    const parsed = JSON.parse(result!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe('user');
  });

  it('overwrites previous conversation history', () => {
    heartbeatStateStore.updateConversationHistory(db, '["first"]');
    heartbeatStateStore.updateConversationHistory(db, '["second"]');

    const result = heartbeatStateStore.getConversationHistory(db);
    expect(result).toBe('["second"]');
  });

  it('clears conversation history when set to null', () => {
    heartbeatStateStore.updateConversationHistory(db, '["data"]');
    heartbeatStateStore.updateConversationHistory(db, null);

    const result = heartbeatStateStore.getConversationHistory(db);
    expect(result).toBeNull();
  });

  it('existing heartbeat state columns still work', () => {
    // Verify the migration didn't break existing columns
    const state = heartbeatStateStore.getHeartbeatState(db);
    expect(state.tickNumber).toBe(0);
    expect(state.currentStage).toBe('idle');

    heartbeatStateStore.updateHeartbeatState(db, { tickNumber: 42 });
    const updated = heartbeatStateStore.getHeartbeatState(db);
    expect(updated.tickNumber).toBe(42);
  });
});

// ============================================================================
// 0.2: cortex settings columns
// ============================================================================

describe('settings-store: cortex settings', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  it('returns defaults when no cortex settings are set', () => {
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexProvider).toBeNull();
    expect(settings.cortexModel).toBeNull();
    expect(settings.cortexThinkingLevel).toBe('off');
    expect(settings.utilityModel).toBe('default');
  });

  it('updates cortex provider', () => {
    settingsStore.updateCortexSettings(db, { cortexProvider: 'anthropic' });
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexProvider).toBe('anthropic');
  });

  it('updates cortex model', () => {
    settingsStore.updateCortexSettings(db, { cortexModel: 'claude-sonnet-4-20250514' });
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexModel).toBe('claude-sonnet-4-20250514');
  });

  it('updates cortex thinking level', () => {
    settingsStore.updateCortexSettings(db, { cortexThinkingLevel: 'high' });
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexThinkingLevel).toBe('high');
  });

  it('updates utility model', () => {
    settingsStore.updateCortexSettings(db, { utilityModel: 'gpt-4o-mini' });
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.utilityModel).toBe('gpt-4o-mini');
  });

  it('updates multiple settings at once', () => {
    settingsStore.updateCortexSettings(db, {
      cortexProvider: 'openai',
      cortexModel: 'gpt-4o',
      cortexThinkingLevel: 'medium',
      utilityModel: 'gpt-4o-mini',
    });
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexProvider).toBe('openai');
    expect(settings.cortexModel).toBe('gpt-4o');
    expect(settings.cortexThinkingLevel).toBe('medium');
    expect(settings.utilityModel).toBe('gpt-4o-mini');
  });

  it('no-ops when no fields are provided', () => {
    settingsStore.updateCortexSettings(db, {});
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexProvider).toBeNull();
  });

  it('cortex settings are also accessible via updateSystemSettings', () => {
    settingsStore.updateSystemSettings(db, {
      cortexProvider: 'google',
      cortexModel: 'gemini-pro',
    } as Partial<import('@animus-labs/shared').SystemSettings>);
    const settings = settingsStore.getCortexSettings(db);
    expect(settings.cortexProvider).toBe('google');
    expect(settings.cortexModel).toBe('gemini-pro');
  });
});

// ============================================================================
// 0.3: credential store additions
// ============================================================================

describe('credential-store: cortex helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  describe('getByProviderPrefix', () => {
    it('returns empty array when no matching credentials', () => {
      const results = credentialStore.getByProviderPrefix(db, 'cortex_');
      expect(results).toHaveLength(0);
    });

    it('finds credentials by type prefix', () => {
      credentialStore.saveCredential(db, 'anthropic', 'cortex_api_key', 'sk-ant-123');
      credentialStore.saveCredential(db, 'openai', 'cortex_api_key', 'sk-oai-456');
      credentialStore.saveCredential(db, 'anthropic', 'legacy_key', 'sk-old');

      const cortex = credentialStore.getByProviderPrefix(db, 'cortex_');
      expect(cortex).toHaveLength(2);
      expect(cortex.every(c => c.credentialType.startsWith('cortex_'))).toBe(true);
    });
  });

  describe('upsertCredential', () => {
    it('inserts a new credential', () => {
      credentialStore.upsertCredential(db, 'cortex_api_key', 'anthropic', 'sk-ant-new');

      const cred = credentialStore.getCredential(db, 'anthropic', 'cortex_api_key');
      expect(cred).not.toBeNull();
      expect(cred!.data).toBe('sk-ant-new');
    });

    it('updates an existing credential', () => {
      credentialStore.upsertCredential(db, 'cortex_api_key', 'anthropic', 'sk-old');
      credentialStore.upsertCredential(db, 'cortex_api_key', 'anthropic', 'sk-new');

      const cred = credentialStore.getCredential(db, 'anthropic', 'cortex_api_key');
      expect(cred!.data).toBe('sk-new');
    });

    it('stores metadata on upsert', () => {
      credentialStore.upsertCredential(db, 'cortex_oauth', 'google', 'token-123', {
        scopes: ['email', 'profile'],
      });

      const cred = credentialStore.getCredential(db, 'google', 'cortex_oauth');
      expect(cred!.metadata).toEqual({ scopes: ['email', 'profile'] });
    });
  });

  describe('updateCredentialData', () => {
    it('returns true when credential exists', () => {
      credentialStore.saveCredential(db, 'anthropic', 'cortex_api_key', 'old-key');
      const updated = credentialStore.updateCredentialData(db, 'cortex_api_key', 'anthropic', 'new-key');
      expect(updated).toBe(true);

      const cred = credentialStore.getCredential(db, 'anthropic', 'cortex_api_key');
      expect(cred!.data).toBe('new-key');
    });

    it('returns false when credential does not exist', () => {
      const updated = credentialStore.updateCredentialData(db, 'cortex_api_key', 'nonexistent', 'data');
      expect(updated).toBe(false);
    });
  });

  describe('deleteByProviderAndType', () => {
    it('deletes a matching credential', () => {
      credentialStore.saveCredential(db, 'anthropic', 'cortex_api_key', 'sk-123');
      const deleted = credentialStore.deleteByProviderAndType(db, 'anthropic', 'cortex_api_key');
      expect(deleted).toBe(true);

      const cred = credentialStore.getCredential(db, 'anthropic', 'cortex_api_key');
      expect(cred).toBeNull();
    });

    it('returns false when no matching credential', () => {
      const deleted = credentialStore.deleteByProviderAndType(db, 'nonexistent', 'cortex_api_key');
      expect(deleted).toBe(false);
    });

    it('does not delete other credentials for the same provider', () => {
      credentialStore.saveCredential(db, 'anthropic', 'cortex_api_key', 'sk-1');
      credentialStore.saveCredential(db, 'anthropic', 'cortex_oauth', 'token-1');

      credentialStore.deleteByProviderAndType(db, 'anthropic', 'cortex_api_key');

      const remaining = credentialStore.getCredential(db, 'anthropic', 'cortex_oauth');
      expect(remaining).not.toBeNull();
      expect(remaining!.data).toBe('token-1');
    });
  });
});
