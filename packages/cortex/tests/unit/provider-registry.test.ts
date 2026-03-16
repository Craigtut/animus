import { describe, it, expect } from 'vitest';
import {
  PROVIDER_REGISTRY,
  OAUTH_PROVIDER_IDS,
  LOGIN_FUNCTION_NAMES,
  UTILITY_MODEL_DEFAULTS,
} from '../../src/provider-registry.js';
import type { ProviderInfo } from '../../src/provider-registry.js';

describe('provider-registry', () => {
  // -----------------------------------------------------------------------
  // PROVIDER_REGISTRY
  // -----------------------------------------------------------------------

  describe('PROVIDER_REGISTRY', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(PROVIDER_REGISTRY)).toBe(true);
      expect(PROVIDER_REGISTRY.length).toBeGreaterThan(0);
    });

    it('contains Anthropic', () => {
      const anthropic = PROVIDER_REGISTRY.find(p => p.id === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic!.name).toBe('Anthropic');
      expect(anthropic!.authMethods).toContain('oauth');
      expect(anthropic!.authMethods).toContain('api_key');
      expect(anthropic!.envVar).toBe('ANTHROPIC_API_KEY');
      expect(anthropic!.keyPrefix).toBe('sk-ant-');
    });

    it('contains OpenAI', () => {
      const openai = PROVIDER_REGISTRY.find(p => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.name).toBe('OpenAI');
      expect(openai!.authMethods).toContain('api_key');
      expect(openai!.envVar).toBe('OPENAI_API_KEY');
    });

    it('contains Google', () => {
      const google = PROVIDER_REGISTRY.find(p => p.id === 'google');
      expect(google).toBeDefined();
      expect(google!.envVar).toBe('GEMINI_API_KEY');
    });

    it('contains OpenAI Codex (OAuth only)', () => {
      const codex = PROVIDER_REGISTRY.find(p => p.id === 'openai-codex');
      expect(codex).toBeDefined();
      expect(codex!.authMethods).toEqual(['oauth']);
      expect(codex!.envVar).toBeUndefined();
    });

    it('contains GitHub Copilot (OAuth only)', () => {
      const copilot = PROVIDER_REGISTRY.find(p => p.id === 'github-copilot');
      expect(copilot).toBeDefined();
      expect(copilot!.authMethods).toEqual(['oauth']);
    });

    it('contains Mistral, Groq, Cerebras, xAI, OpenRouter', () => {
      const expectedApiKeyProviders = ['mistral', 'groq', 'cerebras', 'xai', 'openrouter'];
      for (const id of expectedApiKeyProviders) {
        const provider = PROVIDER_REGISTRY.find(p => p.id === id);
        expect(provider, `Expected provider "${id}" to exist`).toBeDefined();
        expect(provider!.authMethods).toContain('api_key');
        expect(provider!.envVar).toBeDefined();
      }
    });

    it('has unique IDs', () => {
      const ids = PROVIDER_REGISTRY.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every entry has required fields', () => {
      for (const entry of PROVIDER_REGISTRY) {
        expect(typeof entry.id).toBe('string');
        expect(entry.id.length).toBeGreaterThan(0);
        expect(typeof entry.name).toBe('string');
        expect(entry.name.length).toBeGreaterThan(0);
        expect(Array.isArray(entry.authMethods)).toBe(true);
        expect(entry.authMethods.length).toBeGreaterThan(0);

        // Validate auth methods are valid values
        for (const method of entry.authMethods) {
          expect(['oauth', 'api_key']).toContain(method);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // OAUTH_PROVIDER_IDS
  // -----------------------------------------------------------------------

  describe('OAUTH_PROVIDER_IDS', () => {
    it('contains expected OAuth providers', () => {
      expect(OAUTH_PROVIDER_IDS).toContain('anthropic');
      expect(OAUTH_PROVIDER_IDS).toContain('openai-codex');
      expect(OAUTH_PROVIDER_IDS).toContain('github-copilot');
      expect(OAUTH_PROVIDER_IDS).toContain('google-gemini-cli');
    });

    it('does not contain API-key-only providers', () => {
      expect(OAUTH_PROVIDER_IDS).not.toContain('openai');
      expect(OAUTH_PROVIDER_IDS).not.toContain('mistral');
      expect(OAUTH_PROVIDER_IDS).not.toContain('groq');
    });

    it('every OAuth provider ID exists in PROVIDER_REGISTRY or is a known login target', () => {
      // OAuth providers may not all be in the registry (e.g., google-antigravity)
      // but they must all have a corresponding login function
      for (const id of OAUTH_PROVIDER_IDS) {
        expect(LOGIN_FUNCTION_NAMES[id], `Missing login function for "${id}"`).toBeDefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LOGIN_FUNCTION_NAMES
  // -----------------------------------------------------------------------

  describe('LOGIN_FUNCTION_NAMES', () => {
    it('maps anthropic to loginAnthropic', () => {
      expect(LOGIN_FUNCTION_NAMES['anthropic']).toBe('loginAnthropic');
    });

    it('maps openai-codex to loginOpenAICodex', () => {
      expect(LOGIN_FUNCTION_NAMES['openai-codex']).toBe('loginOpenAICodex');
    });

    it('maps github-copilot to loginGitHubCopilot', () => {
      expect(LOGIN_FUNCTION_NAMES['github-copilot']).toBe('loginGitHubCopilot');
    });

    it('maps google-gemini-cli to loginGeminiCli', () => {
      expect(LOGIN_FUNCTION_NAMES['google-gemini-cli']).toBe('loginGeminiCli');
    });

    it('maps google-antigravity to loginAntigravity', () => {
      expect(LOGIN_FUNCTION_NAMES['google-antigravity']).toBe('loginAntigravity');
    });

    it('has entries for all OAUTH_PROVIDER_IDS', () => {
      for (const id of OAUTH_PROVIDER_IDS) {
        expect(LOGIN_FUNCTION_NAMES[id]).toBeDefined();
        expect(typeof LOGIN_FUNCTION_NAMES[id]).toBe('string');
      }
    });
  });

  // -----------------------------------------------------------------------
  // UTILITY_MODEL_DEFAULTS
  // -----------------------------------------------------------------------

  describe('UTILITY_MODEL_DEFAULTS', () => {
    it('maps anthropic to a haiku model', () => {
      expect(UTILITY_MODEL_DEFAULTS['anthropic']).toContain('haiku');
    });

    it('maps openai to gpt-4.1-nano', () => {
      expect(UTILITY_MODEL_DEFAULTS['openai']).toBe('gpt-4.1-nano');
    });

    it('maps google to gemini flash', () => {
      expect(UTILITY_MODEL_DEFAULTS['google']).toContain('flash');
    });

    it('maps groq to a model', () => {
      expect(UTILITY_MODEL_DEFAULTS['groq']).toBeDefined();
    });

    it('maps cerebras to a model', () => {
      expect(UTILITY_MODEL_DEFAULTS['cerebras']).toBeDefined();
    });

    it('maps mistral to mistral-small', () => {
      expect(UTILITY_MODEL_DEFAULTS['mistral']).toContain('mistral-small');
    });

    it('does not have entries for providers without known cheap models', () => {
      // Providers like openrouter, xai, custom have no default mapping
      expect(UTILITY_MODEL_DEFAULTS['openrouter']).toBeUndefined();
      expect(UTILITY_MODEL_DEFAULTS['custom']).toBeUndefined();
    });

    it('all values are non-empty strings', () => {
      for (const [provider, modelId] of Object.entries(UTILITY_MODEL_DEFAULTS)) {
        expect(typeof modelId).toBe('string');
        expect(modelId.length, `Empty model ID for ${provider}`).toBeGreaterThan(0);
      }
    });
  });
});
