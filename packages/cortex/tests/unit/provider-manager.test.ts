import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderManager } from '../../src/provider-manager.js';
import { PROVIDER_REGISTRY, OAUTH_PROVIDER_IDS, UTILITY_MODEL_DEFAULTS } from '../../src/provider-registry.js';
import { isCortexModel, unwrapModel } from '../../src/model-wrapper.js';

// ---------------------------------------------------------------------------
// Mock pi-ai module
// ---------------------------------------------------------------------------

const mockGetModel = vi.fn();
const mockCreateModel = vi.fn();
const mockGetModels = vi.fn();
const mockGetEnvApiKey = vi.fn();
const mockCompleteSimple = vi.fn();

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: (...args: unknown[]) => mockGetModel(...args),
  createModel: (...args: unknown[]) => mockCreateModel(...args),
  getModels: (...args: unknown[]) => mockGetModels(...args),
  getEnvApiKey: (...args: unknown[]) => mockGetEnvApiKey(...args),
  completeSimple: (...args: unknown[]) => mockCompleteSimple(...args),
}));

// Mock pi-ai/oauth module
const mockLoginAnthropic = vi.fn();
const mockGetOAuthApiKey = vi.fn();

vi.mock('@mariozechner/pi-ai/oauth', () => ({
  loginAnthropic: (...args: unknown[]) => mockLoginAnthropic(...args),
  loginOpenAICodex: vi.fn(),
  loginGitHubCopilot: vi.fn(),
  loginGeminiCli: vi.fn(),
  loginAntigravity: vi.fn(),
  getOAuthApiKey: (...args: unknown[]) => mockGetOAuthApiKey(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderManager', () => {
  let pm: ProviderManager;

  beforeEach(() => {
    pm = new ProviderManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  describe('listProviders', () => {
    it('returns the full PROVIDER_REGISTRY', () => {
      const providers = pm.listProviders();
      expect(providers).toBe(PROVIDER_REGISTRY);
      expect(providers.length).toBeGreaterThan(0);
    });

    it('includes anthropic and openai', () => {
      const providers = pm.listProviders();
      const ids = providers.map(p => p.id);
      expect(ids).toContain('anthropic');
      expect(ids).toContain('openai');
    });
  });

  describe('listOAuthProviders', () => {
    it('returns OAUTH_PROVIDER_IDS', () => {
      const oauthProviders = pm.listOAuthProviders();
      expect(oauthProviders).toBe(OAUTH_PROVIDER_IDS);
    });

    it('includes anthropic but not openai', () => {
      const oauthProviders = pm.listOAuthProviders();
      expect(oauthProviders).toContain('anthropic');
      expect(oauthProviders).not.toContain('openai');
    });
  });

  describe('listModels', () => {
    it('delegates to pi-ai getModels and maps to ModelInfo', async () => {
      mockGetModels.mockReturnValue([
        {
          name: 'claude-sonnet-4-20250514',
          displayName: 'Claude Sonnet 4',
          contextWindow: 200000,
          supportsThinking: true,
          supportsImages: true,
          pricing: { input: 3.0, output: 15.0 },
        },
        {
          name: 'claude-haiku-4-5-20250609',
          displayName: 'Claude Haiku 4.5',
          contextWindow: 200000,
          supportsThinking: false,
          supportsImages: true,
        },
      ]);

      const models = await pm.listModels('anthropic');

      expect(mockGetModels).toHaveBeenCalledWith('anthropic');
      expect(models).toHaveLength(2);

      expect(models[0]!.id).toBe('claude-sonnet-4-20250514');
      expect(models[0]!.name).toBe('Claude Sonnet 4');
      expect(models[0]!.contextWindow).toBe(200000);
      expect(models[0]!.supportsThinking).toBe(true);
      expect(models[0]!.supportsImages).toBe(true);
      expect(models[0]!.pricing).toEqual({ input: 3.0, output: 15.0 });

      expect(models[1]!.id).toBe('claude-haiku-4-5-20250609');
      expect(models[1]!.pricing).toBeUndefined();
    });

    it('handles models without displayName', async () => {
      mockGetModels.mockReturnValue([
        { name: 'some-model', contextWindow: 100000 },
      ]);

      const models = await pm.listModels('custom');

      expect(models[0]!.name).toBe('some-model');
    });

    it('defaults contextWindow to 200k when not present', async () => {
      mockGetModels.mockReturnValue([
        { name: 'test-model' },
      ]);

      const models = await pm.listModels('custom');

      expect(models[0]!.contextWindow).toBe(200_000);
    });

    it('returns empty array when provider has no models', async () => {
      mockGetModels.mockReturnValue([]);

      const models = await pm.listModels('unknown-provider');

      expect(models).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // OAuth
  // -----------------------------------------------------------------------

  describe('initiateOAuth', () => {
    it('calls the correct login function for anthropic', async () => {
      mockLoginAnthropic.mockResolvedValue({
        accessToken: 'test-token',
        email: 'user@example.com',
        expiresAt: Date.now() + 3600_000,
        refreshToken: 'refresh-token',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);

      expect(mockLoginAnthropic).toHaveBeenCalledTimes(1);
      expect(typeof result.credentials).toBe('string');
      expect(result.meta.provider).toBe('anthropic');
      expect(result.meta.displayName).toBe('user@example.com');
      expect(result.meta.refreshable).toBe(true);
      expect(result.meta.expiresAt).toBeDefined();
    });

    it('passes callbacks and signal to the login function', async () => {
      mockLoginAnthropic.mockResolvedValue({});

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      await pm.initiateOAuth('anthropic', callbacks);

      const callArgs = mockLoginAnthropic.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs['onAuth']).toBe(callbacks.onAuth);
      expect(callArgs['onPrompt']).toBe(callbacks.onPrompt);
      expect(callArgs['onProgress']).toBe(callbacks.onProgress);
      expect(callArgs['signal']).toBeInstanceOf(AbortSignal);
    });

    it('throws for unknown OAuth provider', async () => {
      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      await expect(pm.initiateOAuth('openai', callbacks))
        .rejects.toThrow('does not support OAuth');
    });

    it('serializes credentials as JSON string', async () => {
      const rawCredentials = { token: 'abc', nested: { key: 'val' } };
      mockLoginAnthropic.mockResolvedValue(rawCredentials);

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);

      expect(JSON.parse(result.credentials)).toEqual(rawCredentials);
    });

    it('clears activeOAuthAbort after successful login', async () => {
      mockLoginAnthropic.mockResolvedValue({});

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      await pm.initiateOAuth('anthropic', callbacks);

      // cancelOAuth should be a no-op now (no active abort)
      pm.cancelOAuth(); // Should not throw
    });

    it('clears activeOAuthAbort after failed login', async () => {
      mockLoginAnthropic.mockRejectedValue(new Error('Login failed'));

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      await expect(pm.initiateOAuth('anthropic', callbacks))
        .rejects.toThrow('Login failed');

      pm.cancelOAuth(); // Should not throw
    });
  });

  describe('cancelOAuth', () => {
    it('does nothing when no OAuth flow is active', () => {
      expect(() => pm.cancelOAuth()).not.toThrow();
    });

    it('aborts an active OAuth flow', async () => {
      // Create a login that hangs until aborted
      let signalRef: AbortSignal | null = null;
      mockLoginAnthropic.mockImplementation(async (opts: Record<string, unknown>) => {
        signalRef = opts['signal'] as AbortSignal;
        return new Promise((_resolve, reject) => {
          (opts['signal'] as AbortSignal).addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        });
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const loginPromise = pm.initiateOAuth('anthropic', callbacks);

      // Wait a tick for the login to start
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(signalRef).not.toBeNull();
      expect(signalRef!.aborted).toBe(false);

      pm.cancelOAuth();

      expect(signalRef!.aborted).toBe(true);

      await expect(loginPromise).rejects.toThrow('Aborted');
    });
  });

  describe('resolveOAuthApiKey', () => {
    it('calls getOAuthApiKey and returns the result', async () => {
      const originalCreds = { accessToken: 'old', refreshToken: 'refresh' };
      const newCreds = { accessToken: 'new', refreshToken: 'refresh' };

      mockGetOAuthApiKey.mockResolvedValue({
        apiKey: 'resolved-api-key',
        newCredentials: newCreds,
      });

      const result = await pm.resolveOAuthApiKey(
        'anthropic',
        JSON.stringify(originalCreds),
      );

      expect(result.apiKey).toBe('resolved-api-key');
      expect(result.changed).toBe(true);
      expect(JSON.parse(result.credentials)).toEqual(newCreds);
      expect(result.meta.provider).toBe('anthropic');
    });

    it('detects when credentials have not changed', async () => {
      const creds = { accessToken: 'same', refreshToken: 'refresh' };

      mockGetOAuthApiKey.mockResolvedValue({
        apiKey: 'api-key',
        newCredentials: creds,
      });

      const serialized = JSON.stringify(creds);
      const result = await pm.resolveOAuthApiKey('anthropic', serialized);

      expect(result.changed).toBe(false);
      expect(result.credentials).toBe(serialized);
    });

    it('throws when getOAuthApiKey returns null', async () => {
      mockGetOAuthApiKey.mockResolvedValue(null);

      await expect(pm.resolveOAuthApiKey('anthropic', '{}'))
        .rejects.toThrow('OAuth resolution failed');
    });
  });

  // -----------------------------------------------------------------------
  // API Key
  // -----------------------------------------------------------------------

  describe('validateApiKey', () => {
    it('returns true when completeSimple succeeds', async () => {
      const mockModel = { provider: 'anthropic', name: 'haiku' };
      mockGetModel.mockReturnValue(mockModel);
      mockCompleteSimple.mockResolvedValue({ content: '' });

      const valid = await pm.validateApiKey('anthropic', 'sk-ant-test-key');

      expect(valid).toBe(true);
      expect(mockGetModel).toHaveBeenCalledWith(
        'anthropic',
        UTILITY_MODEL_DEFAULTS['anthropic'],
      );
      expect(mockCompleteSimple).toHaveBeenCalledWith(
        mockModel,
        { messages: [{ role: 'user', content: 'hi' }] },
        { apiKey: 'sk-ant-test-key', maxTokens: 1 },
      );
    });

    it('returns false when completeSimple throws', async () => {
      mockGetModel.mockReturnValue({});
      mockCompleteSimple.mockRejectedValue(new Error('Invalid API key'));

      const valid = await pm.validateApiKey('anthropic', 'bad-key');

      expect(valid).toBe(false);
    });

    it('falls back to first model when provider has no default', async () => {
      mockGetModels.mockReturnValue([
        { name: 'unknown-model-1' },
        { name: 'unknown-model-2' },
      ]);
      mockGetModel.mockReturnValue({});
      mockCompleteSimple.mockResolvedValue({ content: '' });

      const valid = await pm.validateApiKey('unknown-provider', 'some-key');

      expect(valid).toBe(true);
      expect(mockGetModel).toHaveBeenCalledWith('unknown-provider', 'unknown-model-1');
    });

    it('throws when provider has no models and no default', async () => {
      mockGetModels.mockReturnValue([]);

      await expect(pm.validateApiKey('empty-provider', 'some-key'))
        .rejects.toThrow('No models found');
    });
  });

  describe('checkEnvApiKey', () => {
    it('returns the env var value when set', () => {
      const originalEnv = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-api-key';

      try {
        const key = pm.checkEnvApiKey('anthropic');
        expect(key).toBe('test-api-key');
      } finally {
        if (originalEnv !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalEnv;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('returns null when env var is not set', () => {
      const originalEnv = process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];

      try {
        const key = pm.checkEnvApiKey('anthropic');
        expect(key).toBeNull();
      } finally {
        if (originalEnv !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalEnv;
        }
      }
    });

    it('returns null when env var is empty', () => {
      const originalEnv = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = '';

      try {
        const key = pm.checkEnvApiKey('anthropic');
        expect(key).toBeNull();
      } finally {
        if (originalEnv !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalEnv;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('returns null for unknown provider', () => {
      const key = pm.checkEnvApiKey('unknown-provider');
      expect(key).toBeNull();
    });

    it('returns null for OAuth-only provider without envVar', () => {
      const key = pm.checkEnvApiKey('openai-codex');
      expect(key).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Model Resolution
  // -----------------------------------------------------------------------

  describe('resolveModel', () => {
    it('wraps the pi-ai model as a CortexModel', async () => {
      const piModel = {
        provider: 'anthropic',
        name: 'claude-sonnet-4',
        contextWindow: 200_000,
      };
      mockGetModel.mockReturnValue(piModel);

      const cortexModel = await pm.resolveModel('anthropic', 'claude-sonnet-4');

      expect(isCortexModel(cortexModel)).toBe(true);
      expect(cortexModel.provider).toBe('anthropic');
      expect(cortexModel.modelId).toBe('claude-sonnet-4');
      expect(cortexModel.contextWindow).toBe(200_000);
      expect(cortexModel.__brand).toBe('CortexModel');
    });

    it('unwraps back to the original pi-ai model', async () => {
      const piModel = { provider: 'openai', name: 'gpt-4o', extra: 'data' };
      mockGetModel.mockReturnValue(piModel);

      const cortexModel = await pm.resolveModel('openai', 'gpt-4o');
      const unwrapped = unwrapModel(cortexModel);

      expect(unwrapped).toBe(piModel);
    });

    it('delegates to pi-ai getModel with correct args', async () => {
      mockGetModel.mockReturnValue({});

      await pm.resolveModel('google', 'gemini-2.0-flash');

      expect(mockGetModel).toHaveBeenCalledWith('google', 'gemini-2.0-flash');
    });
  });

  describe('createCustomModel', () => {
    it('creates a CortexModel for a custom endpoint', async () => {
      const piModel = { modelId: 'llama3', baseUrl: 'http://localhost:11434/v1' };
      mockCreateModel.mockReturnValue(piModel);

      const cortexModel = await pm.createCustomModel({
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'llama3',
        contextWindow: 8_000,
      });

      expect(isCortexModel(cortexModel)).toBe(true);
      expect(cortexModel.provider).toBe('custom');
      expect(cortexModel.modelId).toBe('llama3');
      expect(cortexModel.contextWindow).toBe(8_000);
    });

    it('defaults contextWindow to 128k', async () => {
      mockCreateModel.mockReturnValue({});

      const cortexModel = await pm.createCustomModel({
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'my-model',
      });

      expect(cortexModel.contextWindow).toBe(128_000);
    });

    it('passes all config to pi-ai createModel', async () => {
      mockCreateModel.mockReturnValue({});

      await pm.createCustomModel({
        baseUrl: 'http://localhost:8080/v1',
        modelId: 'test',
        contextWindow: 32_000,
        apiKey: 'local-key',
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      });

      expect(mockCreateModel).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:8080/v1',
        modelId: 'test',
        contextWindow: 32_000,
        apiKey: 'local-key',
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      });
    });

    it('unwraps back to the pi-ai model', async () => {
      const piModel = { custom: true };
      mockCreateModel.mockReturnValue(piModel);

      const cortexModel = await pm.createCustomModel({
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'test',
      });

      expect(unwrapModel(cortexModel)).toBe(piModel);
    });
  });

  // -----------------------------------------------------------------------
  // Display name extraction (tested via OAuth results)
  // -----------------------------------------------------------------------

  describe('display name extraction', () => {
    it('extracts email from credentials', async () => {
      mockLoginAnthropic.mockResolvedValue({
        email: 'test@example.com',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.displayName).toBe('test@example.com');
    });

    it('extracts accountId when no email', async () => {
      mockLoginAnthropic.mockResolvedValue({
        accountId: 'user-123',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.displayName).toBe('user-123');
    });

    it('extracts email from JWT idToken', async () => {
      // Create a valid JWT payload with email
      const payload = { email: 'jwt@example.com', sub: '123' };
      const encodedPayload = btoa(JSON.stringify(payload));
      const idToken = `header.${encodedPayload}.signature`;

      mockLoginAnthropic.mockResolvedValue({ idToken });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.displayName).toBe('jwt@example.com');
    });

    it('returns undefined displayName when no identity fields', async () => {
      mockLoginAnthropic.mockResolvedValue({
        accessToken: 'token-only',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.displayName).toBeUndefined();
    });

    it('handles malformed JWT gracefully', async () => {
      mockLoginAnthropic.mockResolvedValue({
        idToken: 'not.a.valid.jwt',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      // Should not crash, displayName should be undefined
      expect(result.meta.displayName).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // OAuthMeta fields
  // -----------------------------------------------------------------------

  describe('OAuthMeta', () => {
    it('marks refreshable when refreshToken exists', async () => {
      mockLoginAnthropic.mockResolvedValue({
        refreshToken: 'refresh-token',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.refreshable).toBe(true);
    });

    it('marks not refreshable when no refreshToken', async () => {
      mockLoginAnthropic.mockResolvedValue({
        accessToken: 'no-refresh',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.refreshable).toBe(false);
    });

    it('includes expiresAt when present', async () => {
      const expires = Date.now() + 3600_000;
      mockLoginAnthropic.mockResolvedValue({
        expiresAt: expires,
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.expiresAt).toBe(expires);
    });

    it('omits expiresAt when not present', async () => {
      mockLoginAnthropic.mockResolvedValue({
        accessToken: 'no-expiry',
      });

      const callbacks = {
        onAuth: vi.fn(),
        onPrompt: vi.fn(),
        onProgress: vi.fn(),
      };

      const result = await pm.initiateOAuth('anthropic', callbacks);
      expect(result.meta.expiresAt).toBeUndefined();
    });
  });
});
