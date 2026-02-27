/**
 * Credential Service — detection, loading, saving, and validation of provider credentials.
 *
 * Central module for managing agent provider authentication across multiple methods:
 * API keys, OAuth tokens, CLI detection, and Codex ChatGPT OAuth.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import * as systemStore from '../db/stores/system-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Credentials', 'server');

// ============================================================================
// Types
// ============================================================================

export type CredentialType = 'api_key' | 'oauth_token' | 'codex_oauth' | 'cli_detected';

export interface ProviderAuthMethod {
  method: 'api_key' | 'oauth_token' | 'codex_oauth' | 'cli';
  available: boolean;
  source: 'database' | 'environment' | 'filesystem';
  detail?: string;
}

export interface ProviderAuthStatus {
  provider: 'claude' | 'codex';
  configured: boolean;
  /** Whether the CLI binary (claude / codex) is installed on the system. */
  cliInstalled: boolean;
  methods: ProviderAuthMethod[];
}

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
// Credential Type Inference
// ============================================================================

/**
 * Auto-detect credential type from the key prefix.
 */
export function inferCredentialType(
  provider: string,
  key: string
): CredentialType {
  if (provider === 'claude') {
    if (key.startsWith('sk-ant-oat01-')) return 'oauth_token';
    if (key.startsWith('sk-ant-api03-')) return 'api_key';
    if (key.startsWith('sk-ant-')) return 'api_key';
    return 'api_key';
  }
  if (provider === 'codex') {
    if (key.startsWith('sk-proj-')) return 'api_key';
    return 'api_key';
  }
  return 'api_key';
}

// ============================================================================
// Environment Loading
// ============================================================================

/** Map of provider + credential type → env var name */
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
  let credentials: systemStore.Credential[];
  try {
    credentials = systemStore.getAllCredentials(db);
  } catch (err) {
    // Table may not exist yet on fresh install
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
      // Set sentinel for Codex OAuth
      process.env['CODEX_OAUTH_CONFIGURED'] = 'true';
      envLoadedCount++;
      log.debug('Loaded codex/codex_oauth (sentinel set)');
    } else if (cred.credentialType === 'cli_detected') {
      // Set sentinel so adapters know CLI auth is available
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
  credentialType?: CredentialType
): { credentialType: CredentialType } {
  const type = credentialType ?? inferCredentialType(provider, key);

  systemStore.saveCredential(db, provider, type, key);

  // Update env var immediately
  const envKey = `${provider}:${type}`;
  const envVar = ENV_MAP[envKey];
  if (envVar) {
    process.env[envVar] = key;
  }

  // Ensure Claude onboarding file for headless SDK usage
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
  provider: string
): void {
  systemStore.saveCredential(db, provider, 'cli_detected', 'detected');
  // Set sentinel env var immediately so adapters see it
  const sentinelVar = provider === 'claude' ? 'CLAUDE_CLI_CONFIGURED' : 'CODEX_CLI_CONFIGURED';
  process.env[sentinelVar] = 'true';
}

/**
 * Remove credentials for a provider and clear env vars.
 */
export function removeCredential(
  db: Database.Database,
  provider: string,
  credentialType?: CredentialType
): void {
  // Find what we're about to delete so we can clear the right env var
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
    // Removing all for provider — clear all possible env vars
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
// Detection
// ============================================================================

/**
 * Detect available authentication methods for all providers.
 */
export async function detectProviderAuth(
  db: Database.Database
): Promise<ProviderAuthStatus[]> {
  const [claude, codex] = await Promise.all([
    detectClaudeAuth(db),
    detectCodexAuth(db),
  ]);
  return [claude, codex];
}

async function detectClaudeAuth(db: Database.Database): Promise<ProviderAuthStatus> {
  const methods: ProviderAuthMethod[] = [];

  // Always check if the claude binary is installed (required for the SDK)
  const cliInstalled = await checkBinaryExists('claude');

  // Check env vars
  if (process.env['ANTHROPIC_API_KEY']) {
    methods.push({
      method: 'api_key',
      available: true,
      source: 'environment',
      detail: 'ANTHROPIC_API_KEY set',
    });
  }

  if (process.env['CLAUDE_CODE_OAUTH_TOKEN']) {
    methods.push({
      method: 'oauth_token',
      available: true,
      source: 'environment',
      detail: 'CLAUDE_CODE_OAUTH_TOKEN set',
    });
  }

  // Check DB credentials (if not already found via env)
  try {
    const dbCreds = systemStore.getCredentialMetadata(db, 'claude');
    for (const cred of dbCreds) {
      const alreadyFound = methods.some(
        (m) => m.method === cred.credentialType || (m.method === 'api_key' && cred.credentialType === 'api_key')
      );
      if (!alreadyFound && cred.credentialType !== 'cli_detected') {
        methods.push({
          method: cred.credentialType as ProviderAuthMethod['method'],
          available: true,
          source: 'database',
        });
      }
    }
  } catch {
    // Table may not exist yet
  }

  // When CLI is installed, ask it directly whether it's authenticated.
  // This is the source of truth (handles macOS Keychain, credential files, etc.)
  if (cliInstalled) {
    const cliAuth = await checkClaudeCliAuth();
    if (cliAuth.authenticated) {
      const alreadyHasCli = methods.some((m) => m.method === 'cli');
      if (!alreadyHasCli) {
        methods.push({
          method: 'cli',
          available: true,
          source: 'filesystem',
          detail: cliAuth.email
            ? `Signed in as ${cliAuth.email}`
            : 'Claude Code authenticated',
        });
      }
    } else {
      // CLI says not authenticated. If we have a stale cli_detected record, clean it up.
      try {
        const hasStaleCli = systemStore.getCredentialMetadata(db, 'claude')
          .some((m) => m.credentialType === 'cli_detected');
        if (hasStaleCli) {
          log.info('Claude CLI no longer authenticated, removing stale cli_detected credential');
          systemStore.deleteCredential(db, 'claude', 'cli_detected');
          delete process.env['CLAUDE_CLI_CONFIGURED'];
        }
      } catch {
        // Ignore
      }

      methods.push({
        method: 'cli',
        available: false,
        source: 'filesystem',
        detail: 'Claude Code installed but not authenticated',
      });
    }
  } else {
    // CLI not installed: fall back to filesystem check for credential files
    try {
      const home = homedir();
      const credsPath = join(home, '.claude', '.credentials');
      const credsJsonPath = join(home, '.claude', '.credentials.json');
      if (existsSync(credsPath) || existsSync(credsJsonPath)) {
        methods.push({
          method: 'cli',
          available: true,
          source: 'filesystem',
          detail: 'Claude Code credentials found',
        });
      }
    } catch {
      // Ignore filesystem errors
    }
  }

  return {
    provider: 'claude',
    configured: methods.some((m) => m.available),
    cliInstalled,
    methods,
  };
}

async function detectCodexAuth(db: Database.Database): Promise<ProviderAuthStatus> {
  const methods: ProviderAuthMethod[] = [];

  // Always check if the codex binary is installed (required for the SDK)
  const cliInstalled = await checkBinaryExists('codex');

  // Check env vars
  if (process.env['OPENAI_API_KEY']) {
    methods.push({
      method: 'api_key',
      available: true,
      source: 'environment',
      detail: 'OPENAI_API_KEY set',
    });
  }

  // Check DB credentials
  try {
    const dbCreds = systemStore.getCredentialMetadata(db, 'codex');
    for (const cred of dbCreds) {
      if (cred.credentialType === 'cli_detected') continue;
      const alreadyFound = methods.some((m) => m.method === cred.credentialType);
      if (!alreadyFound) {
        const entry: ProviderAuthMethod = {
          method: cred.credentialType as ProviderAuthMethod['method'],
          available: true,
          source: 'database',
        };
        if (cred.credentialType === 'codex_oauth') {
          entry.detail = `ChatGPT OAuth (${(cred.metadata as Record<string, unknown>)?.['accountId'] ?? 'connected'})`;
        }
        methods.push(entry);
      }
    }
  } catch {
    // Table may not exist yet
  }

  // When CLI is installed, ask it directly whether it's authenticated.
  // This is the source of truth (handles auth.json, token refresh, etc.)
  if (cliInstalled) {
    const cliAuth = await checkCodexCliAuth();
    if (cliAuth.authenticated) {
      const alreadyHasCli = methods.some((m) => m.method === 'cli');
      if (!alreadyHasCli) {
        methods.push({
          method: 'cli',
          available: true,
          source: 'filesystem',
          detail: 'Codex CLI authenticated',
        });
      }
    } else {
      // CLI says not authenticated. If we have a stale cli_detected record, clean it up.
      try {
        const hasStaleCli = systemStore.getCredentialMetadata(db, 'codex')
          .some((m) => m.credentialType === 'cli_detected');
        if (hasStaleCli) {
          log.info('Codex CLI no longer authenticated, removing stale cli_detected credential');
          systemStore.deleteCredential(db, 'codex', 'cli_detected');
          delete process.env['CODEX_CLI_CONFIGURED'];
        }
      } catch {
        // Ignore
      }

      methods.push({
        method: 'cli',
        available: false,
        source: 'filesystem',
        detail: 'Codex CLI installed but not authenticated',
      });
    }
  } else {
    // CLI not installed: fall back to filesystem check for auth.json
    try {
      const authPath = join(homedir(), '.codex', 'auth.json');
      if (existsSync(authPath)) {
        methods.push({
          method: 'cli',
          available: true,
          source: 'filesystem',
          detail: 'Codex auth.json found',
        });
      }
    } catch {
      // Ignore
    }
  }

  return {
    provider: 'codex',
    configured: methods.some((m) => m.available),
    cliInstalled,
    methods,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a credential against the provider's API.
 */
export async function validateCredential(
  provider: string,
  key: string,
  credentialType: CredentialType
): Promise<ValidationResult> {
  try {
    if (provider === 'claude') {
      return await validateClaudeCredential(key, credentialType);
    }
    if (provider === 'codex') {
      return await validateCodexCredential(key);
    }
    return { valid: false, message: `Unknown provider: ${provider}` };
  } catch (err) {
    return {
      valid: false,
      message: err instanceof Error ? err.message : 'Validation failed',
    };
  }
}

async function validateClaudeCredential(
  key: string,
  credentialType: CredentialType
): Promise<ValidationResult> {
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  };

  if (credentialType === 'oauth_token') {
    headers['Authorization'] = `Bearer ${key}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else {
    headers['x-api-key'] = key;
  }

  const response = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (response.ok) {
    return { valid: true, message: 'Credential verified successfully' };
  }

  if (response.status === 401) {
    return { valid: false, message: 'Invalid credential — authentication failed' };
  }

  if (response.status === 403) {
    // 403 can mean the key is valid but lacks certain permissions — still valid
    return { valid: true, message: 'Credential accepted (limited permissions)' };
  }

  return {
    valid: false,
    message: `Validation failed with status ${response.status}`,
  };
}

async function validateCodexCredential(key: string): Promise<ValidationResult> {
  const response = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.ok) {
    return { valid: true, message: 'API key verified successfully' };
  }

  if (response.status === 401) {
    return { valid: false, message: 'Invalid API key — authentication failed' };
  }

  return {
    valid: false,
    message: `Validation failed with status ${response.status}`,
  };
}

// ============================================================================
// Claude Onboarding File
// ============================================================================

/**
 * Ensure ~/.claude.json has hasCompletedOnboarding: true.
 * Required for headless Claude SDK usage.
 */
export function ensureClaudeOnboardingFile(): void {
  try {
    const filePath = join(homedir(), '.claude.json');

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Corrupt file — overwrite
        data = {};
      }

      if (data['hasCompletedOnboarding'] === true) {
        return; // Already set
      }

      data['hasCompletedOnboarding'] = true;
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } else {
      writeFileSync(filePath, JSON.stringify({ hasCompletedOnboarding: true }, null, 2));
    }
  } catch (err) {
    log.warn('Failed to ensure Claude onboarding file:', err);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a binary exists in PATH with a timeout.
 */
function checkBinaryExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const child = execFile(cmd, [name], { timeout: 2000 }, (err) => {
      resolve(!err);
    });
    // Ensure cleanup on timeout
    child.on('error', () => resolve(false));
  });
}

/**
 * Check Codex CLI authentication status by running `codex login status`.
 * Uses exit code only: 0 = authenticated, non-zero = not authenticated.
 */
function checkCodexCliAuth(): Promise<{ authenticated: boolean }> {
  return new Promise((resolve) => {
    execFile(
      'codex',
      ['login', 'status'],
      { timeout: 5000 },
      (err) => {
        resolve({ authenticated: !err });
      }
    );
  });
}

/**
 * Check Claude CLI authentication status by running `claude auth status --json`.
 * Returns the actual auth state, which may differ from our DB records
 * (e.g., if the user logged out via command line).
 */
function checkClaudeCliAuth(): Promise<{ authenticated: boolean; email?: string }> {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    delete childEnv['CLAUDECODE'];

    execFile(
      'claude',
      ['auth', 'status', '--json'],
      { env: childEnv, timeout: 5000 },
      (err, stdout) => {
        if (err) {
          // CLI errored out; treat as not authenticated
          resolve({ authenticated: false });
          return;
        }

        try {
          const status = JSON.parse(stdout) as Record<string, unknown>;
          const authenticated = status['loggedIn'] === true || status['authenticated'] === true;
          const email = (status['email'] as string) || undefined;
          resolve({ authenticated, ...(email != null ? { email } : {}) });
        } catch {
          // Couldn't parse output; be conservative
          resolve({ authenticated: false });
        }
      }
    );
  });
}
