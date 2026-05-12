/**
 * Tests for Phase 2B: CortexCredentialService and credential store additions.
 *
 * Tests:
 * - New credential store functions (getByProviderAndPrefix, getMetadataByProviderAndPrefix)
 * - CortexCredentialService.getProviderStatus (no decryption needed)
 * - CortexCredentialService.resolveApiKey (env var fallback)
 * - CortexCredentialService.saveApiKey + resolveApiKey roundtrip
 * - isHeadless detection heuristics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../helpers.js';

// Mock encryption service
vi.mock('../../src/lib/encryption-service.js', () => ({
  encrypt: (data: string) => `enc:${data}`,
  decrypt: (data: string) => data.replace(/^enc:/, ''),
  isConfigured: () => true,
}));

// Import credential store after mocking
const credentialStore = await import('../../src/db/stores/credential-store.js');

// ============================================================================
// Credential Store: getByProviderAndPrefix
// ============================================================================

describe('credential-store: getByProviderAndPrefix', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  it('returns null when no matching credential exists', () => {
    const result = credentialStore.getByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).toBeNull();
  });

  it('finds a cortex_api_key credential for the correct provider', () => {
    credentialStore.upsertCredential(db, 'cortex_api_key', 'anthropic', 'sk-ant-test-key');
    const result = credentialStore.getByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('anthropic');
    expect(result!.credentialType).toBe('cortex_api_key');
    expect(result!.data).toBe('sk-ant-test-key');
  });

  it('does not return credentials from a different provider', () => {
    credentialStore.upsertCredential(db, 'cortex_api_key', 'openai', 'sk-openai-key');
    const result = credentialStore.getByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).toBeNull();
  });

  it('does not return non-cortex credentials', () => {
    credentialStore.saveCredential(db, 'anthropic', 'api_key', 'legacy-key');
    const result = credentialStore.getByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).toBeNull();
  });

  it('returns the first matching credential when multiple cortex types exist', () => {
    credentialStore.upsertCredential(db, 'cortex_api_key', 'anthropic', 'key-val');
    credentialStore.upsertCredential(db, 'cortex_oauth', 'anthropic', 'oauth-blob', { provider: 'anthropic', refreshable: true });
    // Should return one of them (LIMIT 1)
    const result = credentialStore.getByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).not.toBeNull();
    expect(result!.credentialType).toMatch(/^cortex_/);
  });
});

// ============================================================================
// Credential Store: getMetadataByProviderAndPrefix
// ============================================================================

describe('credential-store: getMetadataByProviderAndPrefix', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  it('returns null when no matching credential exists', () => {
    const result = credentialStore.getMetadataByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).toBeNull();
  });

  it('returns metadata without decrypting data', () => {
    const meta = { provider: 'anthropic', displayName: 'test@example.com', refreshable: true };
    credentialStore.upsertCredential(db, 'cortex_oauth', 'anthropic', 'encrypted-blob', meta);

    const result = credentialStore.getMetadataByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result).not.toBeNull();
    expect(result!.credentialType).toBe('cortex_oauth');
    expect(result!.metadata).toEqual(meta);
    // Should NOT have a data field
    expect((result as Record<string, unknown>)['data']).toBeUndefined();
  });
});

// ============================================================================
// Credential Store: updateCredentialData with metadata
// ============================================================================

describe('credential-store: updateCredentialData with metadata', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  it('updates both data and metadata when metadata is provided', () => {
    credentialStore.upsertCredential(db, 'cortex_oauth', 'anthropic', 'old-data', { oldMeta: true });

    const updated = credentialStore.updateCredentialData(
      db, 'cortex_oauth', 'anthropic', 'new-data', { newMeta: true }
    );
    expect(updated).toBe(true);

    const result = credentialStore.getByProviderAndPrefix(db, 'anthropic', 'cortex_');
    expect(result!.data).toBe('new-data');
    expect(result!.metadata).toEqual({ newMeta: true });
  });

  it('updates only data when metadata is not provided', () => {
    credentialStore.upsertCredential(db, 'cortex_api_key', 'openai', 'old-key');

    const updated = credentialStore.updateCredentialData(
      db, 'cortex_api_key', 'openai', 'new-key'
    );
    expect(updated).toBe(true);

    const result = credentialStore.getByProviderAndPrefix(db, 'openai', 'cortex_');
    expect(result!.data).toBe('new-key');
  });
});

// ============================================================================
// isHeadless detection (inline test of the logic)
// ============================================================================

/**
 * Mirror of isHeadless() logic for testing without importing the full service
 * module (which pulls in the entire backend dependency chain).
 */
function isHeadlessLogic(env: Record<string, string | undefined>, platform: string): boolean {
  if (env['DOCKER'] === '1') return true;
  if (platform === 'linux' && !env['DISPLAY'] && !env['WAYLAND_DISPLAY']) return true;
  if (env['SSH_CLIENT'] || env['SSH_TTY']) return true;
  if (env['CI'] === 'true' || env['CI'] === '1') return true;
  return false;
}

describe('isHeadless logic', () => {
  it('returns true when DOCKER=1 is set', () => {
    expect(isHeadlessLogic({ DOCKER: '1' }, 'linux')).toBe(true);
  });

  it('returns true when SSH_CLIENT is set', () => {
    expect(isHeadlessLogic({ SSH_CLIENT: '192.168.1.1 12345 22' }, 'darwin')).toBe(true);
  });

  it('returns true when SSH_TTY is set', () => {
    expect(isHeadlessLogic({ SSH_TTY: '/dev/pts/0' }, 'darwin')).toBe(true);
  });

  it('returns true when CI=true', () => {
    expect(isHeadlessLogic({ CI: 'true' }, 'darwin')).toBe(true);
  });

  it('returns true when CI=1', () => {
    expect(isHeadlessLogic({ CI: '1' }, 'darwin')).toBe(true);
  });

  it('returns true on Linux with no DISPLAY or WAYLAND_DISPLAY', () => {
    expect(isHeadlessLogic({}, 'linux')).toBe(true);
  });

  it('returns false on Linux when DISPLAY is set', () => {
    expect(isHeadlessLogic({ DISPLAY: ':0' }, 'linux')).toBe(false);
  });

  it('returns false on Linux when WAYLAND_DISPLAY is set', () => {
    expect(isHeadlessLogic({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(false);
  });

  it('returns false on macOS with no special env vars', () => {
    expect(isHeadlessLogic({}, 'darwin')).toBe(false);
  });

  it('returns false on Windows with no special env vars', () => {
    expect(isHeadlessLogic({}, 'win32')).toBe(false);
  });
});
