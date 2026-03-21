/**
 * ProviderManager: standalone class wrapping pi-ai for provider discovery,
 * OAuth login/refresh, API key validation, model resolution, and custom
 * endpoint creation.
 *
 * ProviderManager and CortexAgent are fully independent. Neither knows
 * about the other. The consumer creates both, uses ProviderManager for
 * auth/discovery, and provides a getApiKey callback to CortexAgent.
 *
 * Pi-ai is an optional peer dependency. All pi-ai functions are imported
 * dynamically. If pi-ai is not installed, methods that require it throw
 * clear errors.
 *
 * Reference: provider-manager.md
 */

import {
  PROVIDER_REGISTRY,
  OAUTH_PROVIDER_IDS,
  LOGIN_FUNCTION_NAMES,
  UTILITY_MODEL_DEFAULTS,
} from './provider-registry.js';
import type { ProviderInfo, ModelInfo } from './provider-registry.js';
import { wrapModel } from './model-wrapper.js';
import type { CortexModel } from './model-wrapper.js';

// ---------------------------------------------------------------------------
// OAuth types
// ---------------------------------------------------------------------------

/** Callbacks provided by the consumer during an OAuth flow. */
export interface OAuthCallbacks {
  /**
   * Called when the user needs to visit a URL to authorize.
   * The consumer should open the URL in a browser or display it.
   * @param url - The authorization URL
   * @param instructions - Optional human-readable instructions
   */
  onAuth: (url: string, instructions?: string) => void;

  /**
   * Called when the OAuth flow needs user input (e.g., a prompt).
   * The consumer should display the prompt and return the user's response.
   */
  onPrompt: (prompt: { message: string }) => Promise<string>;

  /**
   * Called with progress messages during the flow.
   */
  onProgress: (message: string) => void;
}

/** Display-safe metadata extracted at login time. */
export interface OAuthMeta {
  /** Provider identifier. */
  provider: string;
  /** Display name, email, or account identifier (if available). */
  displayName?: string | undefined;
  /** When the access token expires (Unix timestamp ms). Undefined if non-expiring. */
  expiresAt?: number | undefined;
  /** Whether the credential supports automatic refresh. */
  refreshable: boolean;
}

/** Result of a successful OAuth login. */
export interface OAuthResult {
  /**
   * Serialized credential payload. The consumer stores this (encrypted)
   * and passes it back to resolveOAuthApiKey() for refresh.
   * Treat as an opaque blob: encrypt, store, decrypt, pass back. Never parse.
   */
  credentials: string;
  /** Display-safe metadata extracted at login time. */
  meta: OAuthMeta;
}

/** Result of resolving/refreshing an OAuth API key. */
export interface OAuthRefreshResult {
  /** The API key to use for LLM calls. */
  apiKey: string;
  /**
   * Credential payload (may be updated if refresh occurred).
   * Same format as OAuthResult.credentials.
   */
  credentials: string;
  /** Updated metadata. */
  meta: OAuthMeta;
  /** Whether the credentials were actually refreshed (true) or reused as-is (false). */
  changed: boolean;
}

/** Configuration for creating a custom model endpoint. */
export interface CustomModelConfig {
  /** Base URL of the OpenAI-compatible API (e.g., 'http://localhost:11434/v1'). */
  baseUrl: string;
  /** Model identifier to send in API requests. */
  modelId: string;
  /** Context window size (default: 128,000). */
  contextWindow?: number | undefined;
  /** Optional API key (some local servers don't require one). */
  apiKey?: string | undefined;
  /** Compatibility settings for non-standard servers. */
  compat?: {
    /** Whether the server supports the 'developer' role (default: true). */
    supportsDeveloperRole?: boolean | undefined;
    /** Whether the server supports reasoning_effort (default: true). */
    supportsReasoningEffort?: boolean | undefined;
  } | undefined;
}

// ---------------------------------------------------------------------------
// IProviderManager interface
// ---------------------------------------------------------------------------

/**
 * Interface for provider management operations.
 * Consumers can mock this for testing.
 */
export interface IProviderManager {
  // Discovery
  listProviders(): ProviderInfo[];
  listOAuthProviders(): string[];
  listModels(provider: string): Promise<ModelInfo[]>;

  // OAuth
  initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthResult>;
  cancelOAuth(): void;
  resolveOAuthApiKey(provider: string, credentials: string): Promise<OAuthRefreshResult>;

  // API Key
  validateApiKey(provider: string, apiKey: string): Promise<boolean>;
  checkEnvApiKey(provider: string): string | null;

  // Model Resolution
  resolveModel(provider: string, modelId: string): Promise<CortexModel>;
  createCustomModel(config: CustomModelConfig): Promise<CortexModel>;
}

// ---------------------------------------------------------------------------
// Pi-ai dynamic import types
// ---------------------------------------------------------------------------

/** Shape of the pi-ai main module functions we use. */
interface PiAiModule {
  getModel: (provider: string, modelId: string) => unknown;
  createModel: (config: Record<string, unknown>) => unknown;
  getModels: (provider: string) => Array<Record<string, unknown>>;
  getEnvApiKey: (provider: string) => string | undefined;
  completeSimple?: ((model: unknown, context: unknown, options?: unknown) => Promise<unknown>) | undefined;
  complete?: ((model: unknown, context: unknown, options?: unknown) => Promise<unknown>) | undefined;
}

// ---------------------------------------------------------------------------
// Pi-ai dynamic import helpers
// ---------------------------------------------------------------------------

/**
 * Lazily load the pi-ai main module.
 * Throws a clear error if pi-ai is not installed.
 */
async function loadPiAi(): Promise<PiAiModule> {
  try {
    // Dynamic import with string literal to avoid bundler resolution
    const modulePath = '@mariozechner/pi-ai';
    return await import(/* @vite-ignore */ modulePath) as PiAiModule;
  } catch {
    throw new Error(
      'pi-ai is not installed. Install @mariozechner/pi-ai to use ProviderManager.'
    );
  }
}

/**
 * Lazily load the pi-ai OAuth module.
 * Throws a clear error if pi-ai is not installed.
 */
async function loadPiAiOAuth(): Promise<Record<string, unknown>> {
  try {
    const modulePath = '@mariozechner/pi-ai/oauth';
    return await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  } catch {
    throw new Error(
      'pi-ai is not installed. Install @mariozechner/pi-ai to use OAuth features.'
    );
  }
}

// ---------------------------------------------------------------------------
// Display name extraction
// ---------------------------------------------------------------------------

/**
 * Extract the best available display name from OAuth credentials.
 * Different providers include different identity information.
 */
function extractDisplayName(credentials: Record<string, unknown>): string | undefined {
  // Try common fields across providers
  const email = credentials['email'];
  if (typeof email === 'string') return email;

  const accountId = credentials['accountId'];
  if (typeof accountId === 'string') return accountId;

  const idToken = credentials['idToken'];
  if (typeof idToken === 'string') {
    // JWT id_token may contain email in payload
    try {
      const parts = idToken.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1]!)) as Record<string, unknown>;
        const payloadEmail = payload['email'];
        if (typeof payloadEmail === 'string') return payloadEmail;
      }
    } catch {
      // Ignore malformed tokens
    }
  }
  return undefined;
}

/**
 * Build OAuthMeta from raw credential data.
 */
function buildOAuthMeta(
  provider: string,
  rawCredentials: Record<string, unknown>,
): OAuthMeta {
  const displayName = extractDisplayName(rawCredentials);
  const expiresAtRaw = rawCredentials['expiresAt'];
  const expiresAt = typeof expiresAtRaw === 'number' ? expiresAtRaw : undefined;

  const meta: OAuthMeta = {
    provider,
    refreshable: !!rawCredentials['refreshToken'],
  };

  if (displayName !== undefined) {
    meta.displayName = displayName;
  }
  if (expiresAt !== undefined) {
    meta.expiresAt = expiresAt;
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Legacy model filtering
// ---------------------------------------------------------------------------

/**
 * Model ID prefixes considered legacy/deprecated per provider.
 * Pi-ai doesn't flag deprecation, so we maintain this list to keep
 * the model picker clean and prevent users from selecting models that
 * produce poor results with modern tool-use patterns.
 */
const LEGACY_MODEL_PREFIXES: Record<string, string[]> = {
  anthropic: [
    'claude-3-',      // Claude 3.x family (Haiku/Sonnet/Opus from 2024)
    'claude-3.',      // Alternate naming
  ],
  openai: [
    'gpt-3.5-',      // GPT-3.5 family
    'gpt-4-',        // GPT-4 original (not 4o/4.1)
  ],
  google: [
    'gemini-1.',      // Gemini 1.x family
    'gemini-pro',     // Original Gemini Pro
  ],
};

// ---------------------------------------------------------------------------
// Model mapping helper
// ---------------------------------------------------------------------------

/**
 * Map a raw pi-ai model object to our ModelInfo type.
 */
function mapRawToModelInfo(raw: Record<string, unknown>): ModelInfo {
  // pi-ai models have 'id' (API identifier like "claude-sonnet-4-6") and
  // 'name' (display name like "Claude Sonnet 4.6"). Use 'id' as our id.
  const rawId = raw['id'];
  const id = typeof rawId === 'string' ? rawId : String(rawId ?? raw['name'] ?? 'unknown');

  const rawDisplayName = raw['displayName'];
  const rawName = raw['name'];
  const name = typeof rawDisplayName === 'string'
    ? rawDisplayName
    : typeof rawName === 'string'
      ? rawName
      : id;

  const rawContextWindow = raw['contextWindow'];
  const contextWindow = typeof rawContextWindow === 'number' ? rawContextWindow : 200_000;

  const info: ModelInfo = {
    id,
    name,
    contextWindow,
    supportsThinking: !!raw['supportsThinking'],
    supportsImages: !!raw['supportsImages'],
  };

  const rawPricing = raw['pricing'];
  if (rawPricing && typeof rawPricing === 'object') {
    const pricing = rawPricing as Record<string, unknown>;
    const inputPrice = pricing['input'];
    const outputPrice = pricing['output'];
    info.pricing = {
      input: typeof inputPrice === 'number' ? inputPrice : 0,
      output: typeof outputPrice === 'number' ? outputPrice : 0,
    };
  }

  return info;
}

// ---------------------------------------------------------------------------
// ProviderManager implementation
// ---------------------------------------------------------------------------

export class ProviderManager implements IProviderManager {
  /** Active OAuth AbortController, if any. */
  private activeOAuthAbort: AbortController | null = null;

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * List all known providers with their metadata.
   */
  listProviders(): ProviderInfo[] {
    return PROVIDER_REGISTRY;
  }

  /**
   * List provider IDs that support OAuth authentication.
   */
  listOAuthProviders(): string[] {
    return OAUTH_PROVIDER_IDS;
  }

  /**
   * List models available from a provider.
   * Delegates to pi-ai's getModels().
   *
   * @param provider - Provider identifier
   * @returns Array of ModelInfo
   * @throws Error if pi-ai is not installed
   */
  async listModels(provider: string): Promise<ModelInfo[]> {
    const piAi = await loadPiAi();
    const rawModels = piAi.getModels(provider);
    const models = rawModels.map(mapRawToModelInfo);

    // Filter pipeline:
    // 1. Remove legacy/deprecated generation models
    // 2. Remove "-latest" alias duplicates
    // 3. Remove duplicate display names
    const legacyPrefixes = LEGACY_MODEL_PREFIXES[provider];
    const filtered = legacyPrefixes
      ? models.filter(m => !legacyPrefixes.some(prefix => m.id.startsWith(prefix)))
      : models;

    const seen = new Set<string>();
    return filtered.filter(m => {
      // Strip "-latest" suffix to check for duplicate base names
      const baseName = m.id.replace(/-latest$/, '');
      if (m.id.endsWith('-latest')) {
        // Only include the "-latest" alias if no pinned version exists
        return !filtered.some(other => other.id === baseName);
      }
      // Skip duplicates with identical names (different IDs but same display name)
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
  }

  // -----------------------------------------------------------------------
  // OAuth
  // -----------------------------------------------------------------------

  /**
   * Initiate an OAuth login flow for a provider.
   *
   * @param provider - OAuth provider identifier
   * @param callbacks - UI callbacks for auth URL, prompts, and progress
   * @returns The OAuth credentials and display metadata
   * @throws Error if the provider does not support OAuth or pi-ai is not installed
   */
  async initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthResult> {
    const functionName = LOGIN_FUNCTION_NAMES[provider];
    if (!functionName) {
      throw new Error(`Provider "${provider}" does not support OAuth`);
    }

    const oauthModule = await loadPiAiOAuth();
    const loginFn = oauthModule[functionName];
    if (typeof loginFn !== 'function') {
      throw new Error(
        `OAuth login function "${functionName}" not found in pi-ai. ` +
        `Ensure @mariozechner/pi-ai is up to date.`
      );
    }

    this.activeOAuthAbort = new AbortController();

    try {
      const rawCredentials = await (loginFn as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
        onAuth: callbacks.onAuth,
        onPrompt: callbacks.onPrompt,
        onProgress: callbacks.onProgress,
        signal: this.activeOAuthAbort.signal,
      });

      this.activeOAuthAbort = null;

      const credentials = JSON.stringify(rawCredentials);
      const meta = buildOAuthMeta(provider, rawCredentials);

      return { credentials, meta };
    } catch (err) {
      this.activeOAuthAbort = null;
      throw err;
    }
  }

  /**
   * Cancel any in-progress OAuth flow.
   */
  cancelOAuth(): void {
    if (this.activeOAuthAbort) {
      this.activeOAuthAbort.abort();
      this.activeOAuthAbort = null;
    }
  }

  /**
   * Resolve an API key from stored OAuth credentials, refreshing if needed.
   *
   * @param provider - The OAuth provider
   * @param credentials - Serialized credential blob from initiateOAuth()
   * @returns The API key and potentially updated credentials
   * @throws Error if pi-ai is not installed or resolution fails
   */
  async resolveOAuthApiKey(provider: string, credentials: string): Promise<OAuthRefreshResult> {
    const oauthModule = await loadPiAiOAuth();
    const getOAuthApiKeyFn = oauthModule['getOAuthApiKey'];
    if (typeof getOAuthApiKeyFn !== 'function') {
      throw new Error('getOAuthApiKey not found in pi-ai/oauth');
    }

    const rawCredentials = JSON.parse(credentials) as Record<string, unknown>;
    const credMap = { [provider]: { type: 'oauth' as const, ...rawCredentials } };

    const result = await (getOAuthApiKeyFn as (
      provider: string,
      credMap: Record<string, unknown>,
    ) => Promise<{ apiKey: string; newCredentials: Record<string, unknown> } | null>)(
      provider,
      credMap,
    );

    if (!result) {
      throw new Error(`OAuth resolution failed for provider "${provider}"`);
    }

    const originalSerialized = credentials;
    const newSerialized = JSON.stringify(result.newCredentials);
    const changed = newSerialized !== originalSerialized;
    const meta = buildOAuthMeta(provider, result.newCredentials);

    return {
      apiKey: result.apiKey,
      credentials: changed ? newSerialized : credentials,
      meta,
      changed,
    };
  }

  // -----------------------------------------------------------------------
  // API Key
  // -----------------------------------------------------------------------

  /**
   * Validate an API key by making a minimal LLM call (maxTokens: 1).
   *
   * @param provider - The provider to validate against
   * @param apiKey - The API key to validate
   * @returns True if the key is valid, false otherwise
   * @throws Error if pi-ai is not installed
   */
  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    const piAi = await loadPiAi();

    // Find the cheapest model for this provider to minimize validation cost
    const cheapestModelId = this.getSmallestModelId(provider);
    if (!cheapestModelId) {
      // No known model, try a generic test with the provider's first model
      const models = piAi.getModels(provider);
      if (models.length === 0) {
        throw new Error(`No models found for provider "${provider}"`);
      }
      const firstRawId = models[0]!['id'];
      const firstRawName = models[0]!['name'];
      const firstModelId = typeof firstRawId === 'string'
        ? firstRawId
        : typeof firstRawName === 'string'
          ? firstRawName
          : String(firstRawId ?? firstRawName);
      return this.tryValidation(piAi, provider, firstModelId, apiKey);
    }

    return this.tryValidation(piAi, provider, cheapestModelId, apiKey);
  }

  /**
   * Check whether a provider's API key is available in environment variables.
   *
   * @param provider - The provider to check
   * @returns The API key if found, null otherwise
   */
  checkEnvApiKey(provider: string): string | null {
    const entry = PROVIDER_REGISTRY.find(p => p.id === provider);
    if (entry?.envVar) {
      const value = process.env[entry.envVar];
      if (value && value.length > 0) return value;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Model Resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a provider + model ID into a CortexModel.
   *
   * @param provider - The provider identifier
   * @param modelId - The model identifier
   * @returns A CortexModel handle
   * @throws Error if pi-ai is not installed or the model is not found
   */
  async resolveModel(provider: string, modelId: string): Promise<CortexModel> {
    const piAi = await loadPiAi();
    const piModel = piAi.getModel(provider, modelId);
    let contextWindow: number | undefined;
    if (piModel && typeof piModel === 'object') {
      const raw = piModel as Record<string, unknown>;
      const cw = raw['contextWindow'];
      if (typeof cw === 'number') {
        contextWindow = cw;
      }
    }
    return wrapModel(piModel, provider, modelId, contextWindow);
  }

  /**
   * Create a custom model for an OpenAI-compatible endpoint.
   *
   * @param config - Custom model configuration
   * @returns A CortexModel handle
   * @throws Error if pi-ai is not installed
   */
  async createCustomModel(config: CustomModelConfig): Promise<CortexModel> {
    const piAi = await loadPiAi();
    const piModel = piAi.createModel({
      baseUrl: config.baseUrl,
      modelId: config.modelId,
      contextWindow: config.contextWindow ?? 128_000,
      apiKey: config.apiKey,
      compat: config.compat,
    });
    return wrapModel(
      piModel,
      'custom',
      config.modelId,
      config.contextWindow ?? 128_000,
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Get the cheapest known model ID for a provider.
   * Uses the UTILITY_MODEL_DEFAULTS as a proxy for "smallest model."
   */
  private getSmallestModelId(provider: string): string | null {
    return UTILITY_MODEL_DEFAULTS[provider] ?? null;
  }

  /**
   * Attempt to validate an API key by making a minimal LLM call.
   */
  private async tryValidation(
    piAi: PiAiModule,
    provider: string,
    modelId: string,
    apiKey: string,
  ): Promise<boolean> {
    try {
      const model = piAi.getModel(provider, modelId);

      // Try completeSimple first, then complete
      const completeFn = piAi.completeSimple ?? piAi.complete;

      if (typeof completeFn !== 'function') {
        // Cannot validate without a complete function; assume valid
        // (the consumer will discover failures at first real call)
        return true;
      }

      await completeFn(
        model,
        { messages: [{ role: 'user', content: 'hi' }] },
        { apiKey, maxTokens: 1 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
