/**
 * Tests for Phase 0 cortex prep store additions:
 * - session-store: per-thread Cortex session persistence
 * - settings-store: cortex settings columns
 * - credential-store: cortex credential helpers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSessionsDb, createTestSystemDb } from '../../helpers.js';
import * as heartbeatStateStore from '../../../src/db/stores/heartbeat-state-store.js';
import * as sessionStore from '../../../src/db/stores/session-store.js';
import * as settingsStore from '../../../src/db/stores/settings-store.js';

// Credential store needs encryption mocked
vi.mock('../../../src/lib/encryption-service.js', () => ({
  encrypt: (data: string) => `enc:${data}`,
  decrypt: (data: string) => data.replace(/^enc:/, ''),
}));

// Must import credential store AFTER mocking encryption
const credentialStore = await import('../../../src/db/stores/credential-store.js');

// ============================================================================
// 0.1: per-thread Cortex session persistence
// ============================================================================

describe('session-store: mind_sessions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSessionsDb();
  });

  it('returns null when no session has been set', () => {
    const session = sessionStore.getSession(db, 'contact-1', 'web');
    expect(session).toBeNull();
  });

  it('stores and retrieves per-thread conversation history', () => {
    const conversationHistory = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
    const observationalState = JSON.stringify({ version: 1, observations: [] });

    sessionStore.upsertSession(db, 'contact-1', 'web', conversationHistory, observationalState, 1234);
    const result = sessionStore.getSession(db, 'contact-1', 'web');

    expect(result?.conversationHistory).toBe(conversationHistory);
    expect(result?.cortexObservationalState).toBe(observationalState);
    expect(result?.contextTokenCount).toBe(1234);

    const parsed = JSON.parse(result!.conversationHistory!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe('user');
  });

  it('overwrites only the matching contact/channel thread', () => {
    sessionStore.upsertSession(db, 'contact-1', 'web', '["first"]', null, 100);
    sessionStore.upsertSession(db, 'contact-1', 'sms', '["sms"]', null, 200);
    sessionStore.upsertSession(db, 'contact-1', 'web', '["second"]', null, 300);

    expect(sessionStore.getSession(db, 'contact-1', 'web')?.conversationHistory).toBe('["second"]');
    expect(sessionStore.getSession(db, 'contact-1', 'web')?.contextTokenCount).toBe(300);
    expect(sessionStore.getSession(db, 'contact-1', 'sms')?.conversationHistory).toBe('["sms"]');
  });

  it('clears conversation history while preserving the session row', () => {
    sessionStore.upsertSession(db, 'contact-1', 'web', '["data"]', '{"state":true}', 100);
    sessionStore.upsertSession(db, 'contact-1', 'web', null, null, 0);

    const result = sessionStore.getSession(db, 'contact-1', 'web');
    expect(result?.conversationHistory).toBeNull();
    expect(result?.cortexObservationalState).toBeNull();
    expect(result?.contextTokenCount).toBe(0);
  });

  it('deletes sessions by thread and globally', () => {
    sessionStore.upsertSession(db, 'contact-1', 'web', '["web"]', null, 100);
    sessionStore.upsertSession(db, 'contact-2', 'sms', '["sms"]', null, 200);

    sessionStore.deleteSession(db, 'contact-1', 'web');
    expect(sessionStore.getSession(db, 'contact-1', 'web')).toBeNull();
    expect(sessionStore.listSessions(db)).toHaveLength(1);

    sessionStore.deleteAllSessions(db);
    expect(sessionStore.listSessions(db)).toHaveLength(0);
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
    expect(settings.cortexThinkingLevel).toBe('high');
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
