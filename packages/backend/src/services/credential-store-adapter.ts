/**
 * Credential Store Adapter -- implements ICredentialStore from @animus-labs/agents.
 *
 * Thin wrapper that delegates to the system-store DB calls,
 * bridging the agents package auth interface to our SQLite backend.
 */

import type Database from 'better-sqlite3';
import type { ICredentialStore } from '@animus-labs/agents';
import * as systemStore from '../db/stores/system-store.js';

export class CredentialStoreAdapter implements ICredentialStore {
  constructor(private db: Database.Database) {}

  saveCredential(provider: string, type: string, data: string, metadata?: Record<string, unknown>): void {
    systemStore.saveCredential(this.db, provider, type, data, metadata);
    // When CLI auth is detected, also set the env sentinel so adapters see it immediately
    if (type === 'cli_detected') {
      const sentinelVar = provider === 'claude' ? 'CLAUDE_CLI_CONFIGURED' : 'CODEX_CLI_CONFIGURED';
      process.env[sentinelVar] = 'true';
    }
  }

  getCredential(provider: string, type: string): { data: string; metadata?: Record<string, unknown> } | null {
    const cred = systemStore.getCredential(this.db, provider, type);
    if (!cred) return null;
    return {
      data: cred.data,
      ...(cred.metadata != null ? { metadata: cred.metadata } : {}),
    };
  }

  deleteCredential(provider: string, type?: string): boolean {
    systemStore.deleteCredential(this.db, provider, type);
    return true;
  }

  getCredentialMetadata(provider: string): Array<{ credentialType: string; metadata?: Record<string, unknown> }> {
    return systemStore.getCredentialMetadata(this.db, provider).map((m) => ({
      credentialType: m.credentialType,
      ...(m.metadata != null ? { metadata: m.metadata } : {}),
    }));
  }
}

/**
 * Create a credential store adapter for the given database.
 */
export function createCredentialStore(db: Database.Database): ICredentialStore {
  return new CredentialStoreAdapter(db);
}
