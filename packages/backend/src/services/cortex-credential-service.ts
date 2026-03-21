/**
 * Cortex Credential Service
 *
 * Mediates between the tRPC router, the credential store, the encryption
 * service, and Cortex's ProviderManager. This is the single point of contact
 * for all Cortex credential operations.
 *
 * Key behaviors:
 * - resolveApiKey: stored credential (decrypt) -> env var fallback -> OAuth refresh
 * - getProviderStatus: reads metadata (no decryption), works when vault is sealed
 * - Headless/Docker detection via isHeadless() heuristics
 *
 * Credential types are prefixed with "cortex_" to coexist with legacy credentials.
 *
 * See docs/cortex/backend-auth-integration.md
 */

import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import {
  ProviderManager,
  type OAuthCallbacks,
  type OAuthMeta,
  type OAuthResult,
  type CustomModelConfig,
  type CortexModel,
} from '@animus-labs/cortex';
import * as credentialStore from '../db/stores/credential-store.js';
import { isConfigured as isVaultUnsealed } from '../lib/encryption-service.js';
import { getSystemDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CortexCredentialService', 'server');

// ============================================================================
// Types
// ============================================================================

export interface ProviderStatus {
  connected: boolean;
  method: 'oauth' | 'api_key' | 'custom' | 'env_var' | null;
  meta: OAuthMeta | null;
}

export type OAuthStatusEvent =
  | { type: 'auth_url'; url: string; instructions?: string; deviceCode?: string }
  | { type: 'progress'; message: string }
  | { type: 'prompt'; message: string }
  | { type: 'success'; meta: OAuthMeta }
  | { type: 'error'; message: string };

// ============================================================================
// Headless / Docker Detection
// ============================================================================

/**
 * Detect whether the backend is running in a headless environment
 * (Docker, SSH session, no display server). In headless mode, OAuth
 * flows emit the auth URL to the frontend instead of opening a browser.
 */
export function isHeadless(): boolean {
  // Docker detection
  if (process.env['DOCKER'] === '1' || existsSync('/.dockerenv')) return true;
  // No display on Linux
  if (process.platform === 'linux' && !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY']) return true;
  // SSH session
  if (process.env['SSH_CLIENT'] || process.env['SSH_TTY']) return true;
  // CI environment
  if (process.env['CI'] === 'true' || process.env['CI'] === '1') return true;
  return false;
}

// ============================================================================
// CortexCredentialService
// ============================================================================

export class CortexCredentialService {
  private providerManager: ProviderManager;

  constructor() {
    this.providerManager = new ProviderManager();
  }

  /** Get a fresh database handle each call (avoids stale handle after db reopen). */
  private get db(): Database.Database {
    return getSystemDb();
  }

  // ── Provider Manager Delegation ──
  // These methods delegate directly to ProviderManager.
  // They don't involve credentials.

  listProviders() {
    return this.providerManager.listProviders();
  }

  listOAuthProviders() {
    return this.providerManager.listOAuthProviders();
  }

  async listModels(provider: string) {
    return this.providerManager.listModels(provider);
  }

  async resolveModel(provider: string, modelId: string): Promise<CortexModel> {
    return this.providerManager.resolveModel(provider, modelId);
  }

  async createCustomModel(config: CustomModelConfig): Promise<CortexModel> {
    return this.providerManager.createCustomModel(config);
  }

  async testCustomModel(config: CustomModelConfig): Promise<boolean> {
    // Validates by creating a temporary model and making a minimal call
    try {
      const model = await this.providerManager.createCustomModel(config);
      // If createCustomModel succeeds, the endpoint is reachable
      // (pi-ai validates during creation). A full LLM test would require
      // a validate mechanism on the model; for now, successful creation
      // is considered a valid test.
      void model;
      return true;
    } catch {
      return false;
    }
  }

  // ── OAuth ──

  async initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthResult> {
    this.ensureUnsealed('initiateOAuth');

    const result = await this.providerManager.initiateOAuth(provider, callbacks);

    // Store the credential blob (the store handles encryption internally)
    credentialStore.upsertCredential(
      this.db,
      'cortex_oauth',
      provider,
      result.credentials,
      result.meta as unknown as Record<string, unknown>,
    );

    log.info(`OAuth credentials stored for provider "${provider}"`);
    return result;
  }

  cancelOAuth(): void {
    this.providerManager.cancelOAuth();
  }

  // ── API Key ──

  saveApiKey(provider: string, apiKey: string): void {
    this.ensureUnsealed('saveApiKey');
    // Pass plaintext; the store handles encryption internally
    credentialStore.upsertCredential(
      this.db,
      'cortex_api_key',
      provider,
      apiKey,
    );
    log.info(`API key stored for provider "${provider}"`);
  }

  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    return this.providerManager.validateApiKey(provider, apiKey);
  }

  // ── Custom Endpoint ──

  saveCustomEndpoint(config: CustomModelConfig): void {
    this.ensureUnsealed('saveCustomEndpoint');
    // Pass plaintext; the store handles encryption internally
    credentialStore.upsertCredential(
      this.db,
      'cortex_custom',
      'custom',
      config.apiKey ?? '',
      {
        baseUrl: config.baseUrl,
        modelId: config.modelId,
        contextWindow: config.contextWindow,
        compat: config.compat,
      },
    );
    log.info(`Custom endpoint stored: ${config.baseUrl}`);
  }

  // ── Credential Removal ──

  removeCredential(provider: string): void {
    credentialStore.deleteByProviderAndType(this.db, provider, 'cortex_api_key');
    credentialStore.deleteByProviderAndType(this.db, provider, 'cortex_oauth');
    if (provider === 'custom') {
      credentialStore.deleteByProviderAndType(this.db, 'custom', 'cortex_custom');
    }
    log.info(`Credentials removed for provider "${provider}"`);
  }

  // ── Status ──
  // Uses metadata-only queries (no decryption). Works when vault is sealed.

  getProviderStatus(provider: string): ProviderStatus {
    // Check stored credentials (metadata only, no decrypt)
    const credential = credentialStore.getMetadataByProviderAndPrefix(
      this.db, provider, 'cortex_'
    );
    if (!credential) {
      // Check environment variables as fallback
      const envKey = this.providerManager.checkEnvApiKey(provider);
      if (envKey) {
        return { connected: true, method: 'env_var', meta: null };
      }
      return { connected: false, method: null, meta: null };
    }

    const meta = credential.metadata
      ? credential.metadata as unknown as OAuthMeta
      : null;

    return {
      connected: true,
      method: credential.credentialType === 'cortex_oauth' ? 'oauth'
            : credential.credentialType === 'cortex_custom' ? 'custom'
            : 'api_key',
      meta,
    };
  }

  // ── The getApiKey Callback ──
  // This is the callback passed to CortexAgent.
  // It is called by pi-agent-core before every LLM call.

  async resolveApiKey(provider: string): Promise<string> {
    this.ensureUnsealed('resolveApiKey');

    // 1. Try stored credentials
    const credential = credentialStore.getByProviderAndPrefix(
      this.db, provider, 'cortex_'
    );

    if (credential) {
      if (credential.credentialType === 'cortex_api_key') {
        // Already decrypted by getByProviderAndPrefix
        return credential.data;
      }

      if (credential.credentialType === 'cortex_oauth') {
        // credential.data is the decrypted opaque credential blob
        const result = await this.providerManager.resolveOAuthApiKey(
          provider, credential.data
        );

        if (result.changed) {
          // Persist refreshed credentials (store handles encryption internally)
          credentialStore.updateCredentialData(
            this.db,
            'cortex_oauth',
            provider,
            result.credentials,
            result.meta as unknown as Record<string, unknown>,
          );
          log.debug(`OAuth credentials refreshed for provider "${provider}"`);
        }

        return result.apiKey;
      }

      if (credential.credentialType === 'cortex_custom') {
        // Custom endpoints may not need a key; return stored or empty
        return credential.data || '';
      }
    }

    // 2. Fallback to environment variables
    const envKey = this.providerManager.checkEnvApiKey(provider);
    if (envKey) return envKey;

    throw new Error(`No credentials configured for provider "${provider}"`);
  }

  // ── Private ──

  private ensureUnsealed(operation: string): void {
    if (!isVaultUnsealed()) {
      throw new Error(
        `Vault is sealed. Cannot perform "${operation}". ` +
        'Unseal the vault before configuring providers.'
      );
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CortexCredentialService | null = null;

export function getCortexCredentialService(): CortexCredentialService {
  if (!instance) {
    instance = new CortexCredentialService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetCortexCredentialService(): void {
  instance = null;
}
