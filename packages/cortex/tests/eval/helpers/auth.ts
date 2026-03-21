/**
 * Eval Authentication System
 *
 * Handles API key resolution for eval tests with auto-caching OAuth.
 * Provider-agnostic: supports any pi-ai provider, defaulting to Anthropic.
 *
 * Resolution order:
 *   1. Environment variable (e.g., ANTHROPIC_API_KEY)
 *   2. Cached credentials file (.eval-credentials.json)
 *   3. Interactive OAuth flow (opens browser, caches result)
 *
 * The credentials file is gitignored and stored in the cortex package root.
 * OAuth credentials are auto-refreshed on subsequent runs. If the refresh
 * token expires, the interactive flow runs again.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface EvalProviderConfig {
  /** Pi-ai provider identifier. */
  provider: string;
  /** Default model ID for evals (cheapest capable model). */
  modelId: string;
  /** Environment variable name for direct API key. */
  envVar: string;
  /** Whether this provider supports OAuth. */
  supportsOAuth: boolean;
}

/**
 * Registry of providers available for evals.
 * Add new providers here to expand eval coverage.
 */
export const EVAL_PROVIDER_CONFIGS: Record<string, EvalProviderConfig> = {
  anthropic: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    envVar: 'ANTHROPIC_API_KEY',
    supportsOAuth: true,
  },
  // Future providers can be added here:
  // openai: { provider: 'openai', modelId: 'gpt-4.1-nano', envVar: 'OPENAI_API_KEY', supportsOAuth: false },
  // google: { provider: 'google', modelId: 'gemini-2.5-flash-lite', envVar: 'GEMINI_API_KEY', supportsOAuth: false },
};

/** The default provider used for evals. */
export const DEFAULT_EVAL_PROVIDER = 'anthropic';

// ---------------------------------------------------------------------------
// Credentials cache
// ---------------------------------------------------------------------------

/** Path to the credentials cache file (cortex package root). */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.resolve(__dirname, '..', '..', '..', '.eval-credentials.json');

interface CachedProviderCredentials {
  type: 'oauth' | 'api_key';
  /** Serialized OAuth credentials blob (opaque, for getOAuthApiKey). */
  oauthCredentials?: string;
  /** Direct API key (only for type: 'api_key'). */
  apiKey?: string;
  /** Timestamp of last successful use. */
  lastUsed?: number;
}

interface CredentialsCache {
  [provider: string]: CachedProviderCredentials;
}

function loadCredentialsCache(): CredentialsCache {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      return JSON.parse(raw) as CredentialsCache;
    }
  } catch {
    // Corrupt file, start fresh
  }
  return {};
}

function saveCredentialsCache(cache: CredentialsCache): void {
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Pi-ai OAuth dynamic imports
// ---------------------------------------------------------------------------

interface PiAiOAuthModule {
  loginAnthropic: (opts: {
    onAuth: (info: { url: string; instructions?: string } | string, legacyInstructions?: string) => void;
    onPrompt: (prompt: { message: string }) => Promise<string>;
    onProgress: (message: string) => void;
    signal?: AbortSignal;
  }) => Promise<Record<string, unknown>>;
  getOAuthApiKey: (
    provider: string,
    credMap: Record<string, unknown>,
  ) => Promise<{ apiKey: string; newCredentials: Record<string, unknown> } | null>;
  [key: string]: unknown;
}

async function loadPiAiOAuth(): Promise<PiAiOAuthModule> {
  const modulePath = '@mariozechner/pi-ai/oauth';
  return await import(modulePath) as PiAiOAuthModule;
}

// ---------------------------------------------------------------------------
// OAuth login function registry (mirrors provider-registry.ts pattern)
// ---------------------------------------------------------------------------

const OAUTH_LOGIN_FUNCTIONS: Record<string, string> = {
  anthropic: 'loginAnthropic',
  'openai-codex': 'loginOpenAICodex',
  'github-copilot': 'loginGitHubCopilot',
  'google-gemini-cli': 'loginGeminiCli',
};

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

/** In-memory cache of resolved API keys (avoids re-resolving per test). */
const resolvedKeys = new Map<string, string>();

/**
 * Resolve an API key for the given provider.
 *
 * Resolution order:
 *   1. In-memory cache (from earlier in this test run)
 *   2. Environment variable
 *   3. Cached OAuth credentials (auto-refreshed)
 *   4. Interactive OAuth flow (opens browser)
 *
 * @param providerName - Provider key from EVAL_PROVIDER_CONFIGS (default: 'anthropic')
 * @returns The API key string
 * @throws Error if no key could be resolved
 */
export async function resolveEvalApiKey(providerName: string = DEFAULT_EVAL_PROVIDER): Promise<string> {
  // 1. In-memory cache
  const cached = resolvedKeys.get(providerName);
  if (cached) return cached;

  const config = EVAL_PROVIDER_CONFIGS[providerName];
  if (!config) {
    throw new Error(`Unknown eval provider: "${providerName}". Known: ${Object.keys(EVAL_PROVIDER_CONFIGS).join(', ')}`);
  }

  // 2. Environment variable
  const envKey = process.env[config.envVar];
  if (envKey && envKey.length > 0) {
    resolvedKeys.set(providerName, envKey);
    return envKey;
  }

  // 3. Cached OAuth credentials
  const credCache = loadCredentialsCache();
  const providerCreds = credCache[config.provider];

  if (providerCreds) {
    if (providerCreds.type === 'api_key' && providerCreds.apiKey) {
      resolvedKeys.set(providerName, providerCreds.apiKey);
      return providerCreds.apiKey;
    }

    if (providerCreds.type === 'oauth' && providerCreds.oauthCredentials) {
      try {
        const apiKey = await refreshOAuthKey(config.provider, providerCreds.oauthCredentials);
        if (apiKey) {
          providerCreds.lastUsed = Date.now();
          saveCredentialsCache(credCache);
          resolvedKeys.set(providerName, apiKey.key);
          // Update cached credentials if they were refreshed
          if (apiKey.updatedCredentials) {
            providerCreds.oauthCredentials = apiKey.updatedCredentials;
            saveCredentialsCache(credCache);
          }
          return apiKey.key;
        }
      } catch (err) {
        console.log(`  Cached OAuth credentials expired or invalid: ${err instanceof Error ? err.message : String(err)}`);
        console.log('  Falling through to interactive login...');
      }
    }
  }

  // 4. Interactive OAuth login
  if (!config.supportsOAuth) {
    throw new Error(
      `No API key found for "${providerName}". ` +
      `Set ${config.envVar} environment variable, or add an api_key entry to ${CREDENTIALS_PATH}.`
    );
  }

  console.log(`\n  No credentials found for ${providerName}. Starting OAuth login...`);
  const result = await runInteractiveOAuth(config.provider);

  // Cache the credentials
  credCache[config.provider] = {
    type: 'oauth',
    oauthCredentials: result.credentials,
    lastUsed: Date.now(),
  };
  saveCredentialsCache(credCache);

  resolvedKeys.set(providerName, result.apiKey);
  return result.apiKey;
}

/**
 * Check if credentials are already available for a provider.
 * Used for test skipping decisions in non-interactive contexts.
 *
 * Returns true ONLY if credentials exist right now (env var or cached file).
 * Does NOT return true just because OAuth is available, since OAuth requires
 * user interaction. Use canRunEvals() if you want to include OAuth capability.
 */
export function hasEvalCredentials(providerName: string = DEFAULT_EVAL_PROVIDER): boolean {
  const config = EVAL_PROVIDER_CONFIGS[providerName];
  if (!config) return false;

  // Check env var
  const envKey = process.env[config.envVar];
  if (envKey && envKey.length > 0) return true;

  // Check cached credentials file
  const credCache = loadCredentialsCache();
  const providerCreds = credCache[config.provider];
  if (providerCreds) return true;

  return false;
}

/**
 * Check if evals can potentially run (credentials available OR OAuth is possible).
 * Use this when you want to include interactive OAuth as an option.
 */
export function canRunEvals(providerName: string = DEFAULT_EVAL_PROVIDER): boolean {
  if (hasEvalCredentials(providerName)) return true;

  const config = EVAL_PROVIDER_CONFIGS[providerName];
  return !!config?.supportsOAuth;
}

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

interface RefreshResult {
  key: string;
  updatedCredentials?: string;
}

async function refreshOAuthKey(provider: string, credentials: string): Promise<RefreshResult | null> {
  const oauthModule = await loadPiAiOAuth();

  const rawCredentials = JSON.parse(credentials) as Record<string, unknown>;
  const credMap = { [provider]: { type: 'oauth' as const, ...rawCredentials } };

  const result = await oauthModule.getOAuthApiKey(provider, credMap);
  if (!result) return null;

  const originalJson = credentials;
  const newJson = JSON.stringify(result.newCredentials);
  const changed = newJson !== originalJson;

  return {
    key: result.apiKey,
    updatedCredentials: changed ? newJson : undefined,
  };
}

interface OAuthLoginResult {
  apiKey: string;
  credentials: string;
}

async function runInteractiveOAuth(provider: string): Promise<OAuthLoginResult> {
  const oauthModule = await loadPiAiOAuth();

  const loginFnName = OAUTH_LOGIN_FUNCTIONS[provider];
  if (!loginFnName) {
    throw new Error(`No OAuth login function known for provider "${provider}"`);
  }

  const loginFn = oauthModule[loginFnName];
  if (typeof loginFn !== 'function') {
    throw new Error(`OAuth login function "${loginFnName}" not found in pi-ai/oauth`);
  }

  console.log('');

  const rawCredentials = await (loginFn as typeof oauthModule.loginAnthropic)({
    onAuth: (info: { url: string; instructions?: string } | string, legacyInstructions?: string) => {
      // Pi-ai passes { url, instructions } object; handle both shapes for safety
      const authUrl = typeof info === 'string' ? info : info.url;
      const instructions = typeof info === 'string' ? legacyInstructions : info.instructions;

      console.log('  ╔══════════════════════════════════════════════════╗');
      console.log('  ║  OAuth Authorization Required                   ║');
      console.log('  ╠══════════════════════════════════════════════════╣');
      if (instructions) {
        console.log(`  ║  ${instructions}`);
      }
      console.log(`  ║  URL: ${authUrl}`);
      console.log('  ╚══════════════════════════════════════════════════╝');
      console.log('');

      // Try to open the URL in the default browser
      try {
        if (process.platform === 'darwin') {
          execSync(`open "${authUrl}"`, { stdio: 'ignore' });
          console.log('  Browser opened automatically.');
        } else if (process.platform === 'linux') {
          execSync(`xdg-open "${authUrl}"`, { stdio: 'ignore' });
        }
      } catch {
        console.log('  Please open the URL above in your browser.');
      }
      console.log('  Waiting for authorization...\n');
    },
    onPrompt: async (prompt: { message: string }) => {
      // This shouldn't happen for Anthropic OAuth, but handle it
      console.log(`  Prompt: ${prompt.message}`);
      return '';
    },
    onProgress: (message: string) => {
      console.log(`  ${message}`);
    },
  });

  const credentials = JSON.stringify(rawCredentials);

  // Immediately resolve an API key from the fresh credentials
  const credMap = { [provider]: { type: 'oauth' as const, ...rawCredentials } };
  const keyResult = await oauthModule.getOAuthApiKey(provider, credMap);

  if (!keyResult) {
    throw new Error('OAuth login succeeded but could not resolve an API key');
  }

  console.log('  OAuth login successful! Credentials cached.\n');

  return {
    apiKey: keyResult.apiKey,
    credentials: JSON.stringify(keyResult.newCredentials),
  };
}

// ---------------------------------------------------------------------------
// Manual credential management
// ---------------------------------------------------------------------------

/**
 * Store a plain API key in the credentials cache.
 * Useful for providers that don't support OAuth.
 *
 * @param provider - Provider key from EVAL_PROVIDER_CONFIGS
 * @param apiKey - The API key to store
 */
export function storeApiKey(provider: string, apiKey: string): void {
  const cache = loadCredentialsCache();
  cache[provider] = { type: 'api_key', apiKey, lastUsed: Date.now() };
  saveCredentialsCache(cache);
}

/**
 * Clear cached credentials for a provider (or all providers).
 */
export function clearCredentials(provider?: string): void {
  if (provider) {
    const cache = loadCredentialsCache();
    delete cache[provider];
    saveCredentialsCache(cache);
  } else {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      fs.unlinkSync(CREDENTIALS_PATH);
    }
  }
}

/**
 * Get the path to the credentials cache file.
 */
export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}
