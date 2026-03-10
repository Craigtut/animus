/**
 * Credential Service -- detection, loading, saving, and validation of provider credentials.
 *
 * Central module for managing agent provider authentication across multiple methods:
 * API keys, OAuth tokens, CLI detection, and Codex ChatGPT OAuth.
 *
 * Auth detection and validation are delegated to auth providers in @animus-labs/agents.
 * This service retains: environment loading, DB persistence, and env var management.
 */

import type Database from 'better-sqlite3';
import * as systemStore from '../db/stores/system-store.js';
import { createLogger } from '../lib/logger.js';
import { isUnsealed } from '../lib/vault-manager.js';
import {
  ClaudeAuthProvider,
  CodexAuthProvider,
  inferCredentialType as inferType,
  ensureClaudeOnboardingFile as ensureOnboarding,
  type CredentialType,
  type ProviderAuthStatus,
} from '@animus-labs/agents';
import { createCredentialStore } from './credential-store-adapter.js';

export type { CredentialType };
export type { ProviderAuthStatus };

// Re-export for backend consumers
export const ensureClaudeOnboardingFile = ensureOnboarding;

const log = createLogger('Credentials', 'server');

// Re-export types that other backend files use
export type { ProviderAuthMethod } from '@animus-labs/agents';

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export interface CredentialLoadSummary {
  storedCount: number;
  envLoadedCount: number;
  cliDetectedProviders: string[];
}

// ============================================================================
// Credential Type Inference (delegates to agents package)
// ============================================================================

export function inferCredentialType(provider: string, key: string): CredentialType {
  return inferType(provider, key);
}

// ============================================================================
// Environment Loading
// ============================================================================

/** Map of provider + credential type to env var name */
const ENV_MAP: Record<string, string> = {
  'claude:api_key': 'ANTHROPIC_API_KEY',
  'claude:oauth_token': 'CLAUDE_CODE_OAUTH_TOKEN',
  'codex:api_key': 'OPENAI_API_KEY',
};

/**
 * Load all stored credentials into process.env at startup.
 * Called once after database initialization.
 */
export function loadCredentialsIntoEnv(db: Database.Database): CredentialLoadSummary {
  if (!isUnsealed()) {
    log.info('Vault is sealed: skipping credential loading');
    return { storedCount: 0, envLoadedCount: 0, cliDetectedProviders: [] };
  }

  let credentials: systemStore.Credential[];
  try {
    credentials = systemStore.getAllCredentials(db);
  } catch (err) {
    log.info('Could not load credentials:', err instanceof Error ? err.message : err);
    return { storedCount: 0, envLoadedCount: 0, cliDetectedProviders: [] };
  }

  log.debug(`Found ${credentials.length} stored credential(s): ${credentials.map(c => `${c.provider}/${c.credentialType}`).join(', ') || 'none'}`);
  let envLoadedCount = 0;
  const cliDetectedProviders = new Set<string>();

  for (const cred of credentials) {
    const key = `${cred.provider}:${cred.credentialType}`;
    const envVar = ENV_MAP[key];

    if (envVar) {
      process.env[envVar] = cred.data;
      envLoadedCount++;
      log.debug(`Loaded ${cred.provider}/${cred.credentialType} into ${envVar}`);
    } else if (cred.credentialType === 'codex_oauth') {
      process.env['CODEX_OAUTH_CONFIGURED'] = 'true';
      envLoadedCount++;
      log.debug('Loaded codex/codex_oauth (sentinel set)');
    } else if (cred.credentialType === 'cli_detected') {
      const sentinelVar = cred.provider === 'claude' ? 'CLAUDE_CLI_CONFIGURED' : 'CODEX_CLI_CONFIGURED';
      process.env[sentinelVar] = 'true';
      envLoadedCount++;
      cliDetectedProviders.add(cred.provider);
      log.debug(`Loaded ${cred.provider}/cli_detected (${sentinelVar} set)`);
    }
  }

  return {
    storedCount: credentials.length,
    envLoadedCount,
    cliDetectedProviders: Array.from(cliDetectedProviders).sort((a, b) => a.localeCompare(b)),
  };
}

// ============================================================================
// Save / Remove
// ============================================================================

/**
 * Save a credential: encrypt, store in DB, update process.env.
 */
export function saveCredential(
  db: Database.Database,
  provider: string,
  key: string,
  credentialType?: CredentialType,
): { credentialType: CredentialType } {
  const type = credentialType ?? inferCredentialType(provider, key);

  systemStore.saveCredential(db, provider, type, key);

  const envKey = `${provider}:${type}`;
  const envVar = ENV_MAP[envKey];
  if (envVar) {
    process.env[envVar] = key;
  }

  if (provider === 'claude') {
    ensureClaudeOnboardingFile();
  }

  return { credentialType: type };
}

/**
 * Save a CLI detection sentinel.
 */
export function saveCliDetected(
  db: Database.Database,
  provider: string,
): void {
  systemStore.saveCredential(db, provider, 'cli_detected', 'detected');
  const sentinelVar = provider === 'claude' ? 'CLAUDE_CLI_CONFIGURED' : 'CODEX_CLI_CONFIGURED';
  process.env[sentinelVar] = 'true';
}

/**
 * Remove credentials for a provider and clear env vars.
 */
export function removeCredential(
  db: Database.Database,
  provider: string,
  credentialType?: CredentialType,
): void {
  if (credentialType) {
    const envKey = `${provider}:${credentialType}`;
    const envVar = ENV_MAP[envKey];
    if (envVar) {
      delete process.env[envVar];
    }
    if (credentialType === 'codex_oauth') {
      delete process.env['CODEX_OAUTH_CONFIGURED'];
    }
    if (credentialType === 'cli_detected') {
      delete process.env[provider === 'claude' ? 'CLAUDE_CLI_CONFIGURED' : 'CODEX_CLI_CONFIGURED'];
    }
  } else {
    for (const [key, envVar] of Object.entries(ENV_MAP)) {
      if (key.startsWith(`${provider}:`)) {
        delete process.env[envVar];
      }
    }
    if (provider === 'codex') {
      delete process.env['CODEX_OAUTH_CONFIGURED'];
      delete process.env['CODEX_CLI_CONFIGURED'];
    }
    if (provider === 'claude') {
      delete process.env['CLAUDE_CLI_CONFIGURED'];
    }
  }

  systemStore.deleteCredential(db, provider, credentialType);
}

// ============================================================================
// Detection (delegates to adapter auth providers)
// ============================================================================

const claudeAuth = new ClaudeAuthProvider();
const codexAuth = new CodexAuthProvider();

/**
 * Detect available authentication methods for all providers.
 * Delegates to auth providers in @animus-labs/agents, then cleans up
 * stale DB records based on the reported status.
 */
export async function detectProviderAuth(
  db: Database.Database,
): Promise<ProviderAuthStatus[]> {
  const store = createCredentialStore(db);

  const [claude, codex] = await Promise.all([
    claudeAuth.detectAuth(store),
    codexAuth.detectAuth(store),
  ]);

  // Clean up stale cli_detected records based on adapter detection results
  cleanupStaleCli(db, claude);
  cleanupStaleCli(db, codex);

  return [claude, codex];
}

/**
 * If the auth provider reports CLI is not available, and we have a stale
 * cli_detected record in the DB, clean it up.
 */
function cleanupStaleCli(db: Database.Database, status: ProviderAuthStatus): void {
  const cliMethod = status.methods.find((m) => m.method === 'cli');
  if (cliMethod && !cliMethod.available) {
    try {
      const hasStaleCli = systemStore.getCredentialMetadata(db, status.provider)
        .some((m) => m.credentialType === 'cli_detected');
      if (hasStaleCli) {
        log.info(`${status.provider} CLI no longer authenticated, removing stale cli_detected credential`);
        systemStore.deleteCredential(db, status.provider, 'cli_detected');
        const sentinelVar = status.provider === 'claude' ? 'CLAUDE_CLI_CONFIGURED' : 'CODEX_CLI_CONFIGURED';
        delete process.env[sentinelVar];
      }
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Validation (delegates to adapter auth providers)
// ============================================================================

/**
 * Validate a credential against the provider's API.
 */
export async function validateCredential(
  provider: string,
  key: string,
  credentialType: CredentialType,
): Promise<ValidationResult> {
  try {
    if (provider === 'claude') {
      return await claudeAuth.validateCredential!(key, credentialType);
    }
    if (provider === 'codex') {
      return await codexAuth.validateCredential!(key);
    }
    return { valid: false, message: `Unknown provider: ${provider}` };
  } catch (err) {
    return {
      valid: false,
      message: err instanceof Error ? err.message : 'Validation failed',
    };
  }
}
