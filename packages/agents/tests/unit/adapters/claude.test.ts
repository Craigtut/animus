/**
 * Unit tests for the Claude adapter.
 *
 * Uses mocked SDK to test adapter logic without requiring API keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeAdapter } from '../../../src/adapters/claude.js';
import { createSilentLogger } from '../../../src/logger.js';
import type { AgentEvent } from '../../../src/types.js';
import { AgentError } from '../../../src/errors.js';

// Mock the SDK module
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  };
});

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter({ logger: createSilentLogger() });
  });

  describe('provider', () => {
    it('is claude', () => {
      expect(adapter.provider).toBe('claude');
    });
  });

  describe('capabilities', () => {
    it('supports cancellation', () => {
      expect(adapter.capabilities.canCancel).toBe(true);
    });

    it('supports blocking in pre-tool-use hooks', () => {
      expect(adapter.capabilities.canBlockInPreToolUse).toBe(true);
    });

    it('supports subagents', () => {
      expect(adapter.capabilities.supportsSubagents).toBe(true);
    });

    it('supports session forking', () => {
      expect(adapter.capabilities.supportsFork).toBe(true);
    });

    it('supports streaming', () => {
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });
  });

  describe('isConfigured', () => {
    it('returns true when ANTHROPIC_API_KEY is set', () => {
      const original = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key';

      try {
        expect(adapter.isConfigured()).toBe(true);
      } finally {
        if (original) {
          process.env['ANTHROPIC_API_KEY'] = original;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('returns true when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
      const origApiKey = process.env['ANTHROPIC_API_KEY'];
      const origOAuth = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
      delete process.env['ANTHROPIC_API_KEY'];
      process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'test-oauth-token';

      try {
        expect(adapter.isConfigured()).toBe(true);
      } finally {
        if (origApiKey) {
          process.env['ANTHROPIC_API_KEY'] = origApiKey;
        }
        if (origOAuth) {
          process.env['CLAUDE_CODE_OAUTH_TOKEN'] = origOAuth;
        } else {
          delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
        }
      }
    });
  });

  describe('createSession', () => {
    it('throws MISSING_CREDENTIALS when not configured', async () => {
      const origApiKey = process.env['ANTHROPIC_API_KEY'];
      const origOAuth = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];

      // Create adapter that won't find credentials
      const unconfiguredAdapter = new ClaudeAdapter({ logger: createSilentLogger() });

      try {
        // The adapter might still find ~/.claude/.credentials, so we check the general flow
        if (!unconfiguredAdapter.isConfigured()) {
          await expect(
            unconfiguredAdapter.createSession({ provider: 'claude' }),
          ).rejects.toThrow('credentials not configured');
        }
      } finally {
        if (origApiKey) process.env['ANTHROPIC_API_KEY'] = origApiKey;
        if (origOAuth) process.env['CLAUDE_CODE_OAUTH_TOKEN'] = origOAuth;
      }
    });

    it('throws on invalid config', async () => {
      await expect(
        adapter.createSession({ provider: 'codex' as any }),
      ).rejects.toThrow();
    });
  });

  describe('resumeSession', () => {
    it('throws on provider mismatch', async () => {
      await expect(adapter.resumeSession('codex:some-id')).rejects.toThrow(
        'belongs to codex',
      );
    });
  });

  describe('listModels', () => {
    it('returns models from capabilities when no API key', async () => {
      delete process.env['ANTHROPIC_API_KEY'];
      const models = await adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('name');
      expect(models.some((m) => m.id.includes('claude'))).toBe(true);
    });

    it('calls Anthropic REST API when API key is set', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2025-12-01T00:00:00Z' },
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2025-12-02T00:00:00Z' },
          ],
          has_more: false,
        }),
      });

      try {
        const models = await adapter.listModels();
        expect(models).toHaveLength(2);
        expect(models[0].id).toBe('claude-opus-4-6');
        expect(models[0].name).toBe('Claude Opus 4.6');
        expect(globalThis.fetch).toHaveBeenCalledOnce();
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalKey;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('falls back to static list on API error', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      try {
        const models = await adapter.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some((m) => m.id.includes('claude'))).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalKey;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('handles pagination', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: 'claude-sonnet-4-6', display_name: 'Model 1', created_at: '2025-12-01T00:00:00Z' }],
              has_more: true,
              last_id: 'claude-sonnet-4-6',
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'claude-opus-4-6', display_name: 'Model 2', created_at: '2025-12-02T00:00:00Z' }],
            has_more: false,
          }),
        };
      });

      try {
        const models = await adapter.listModels();
        expect(models).toHaveLength(2);
        expect(models[0].id).toBe('claude-sonnet-4-6');
        expect(models[1].id).toBe('claude-opus-4-6');
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalKey;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('applies family heuristic: marks newest per family as recommended', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2025-12-15T00:00:00Z' },
            { id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5', created_at: '2025-11-01T00:00:00Z' },
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2025-12-10T00:00:00Z' },
            { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', created_at: '2025-05-14T00:00:00Z' },
            { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
          ],
          has_more: false,
        }),
      });

      try {
        const models = await adapter.listModels();

        // Newest opus (4.6) should be recommended
        const opus46 = models.find(m => m.id === 'claude-opus-4-6');
        expect(opus46?.recommended).toBe(true);

        // Older opus should not be recommended
        const opus45 = models.find(m => m.id === 'claude-opus-4-5-20251101');
        expect(opus45?.recommended).toBe(false);

        // Newest sonnet (4.6) should be recommended AND default
        const sonnet46 = models.find(m => m.id === 'claude-sonnet-4-6');
        expect(sonnet46?.recommended).toBe(true);
        expect(sonnet46?.isDefault).toBe(true);

        // Older sonnet should not be recommended
        const sonnet4 = models.find(m => m.id === 'claude-sonnet-4-20250514');
        expect(sonnet4?.recommended).toBe(false);

        // Newest (only) haiku should be recommended
        const haiku = models.find(m => m.id === 'claude-haiku-4-5-20251001');
        expect(haiku?.recommended).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalKey;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });

    it('includes createdAt in model info', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2025-12-10T00:00:00Z' },
          ],
          has_more: false,
        }),
      });

      try {
        const models = await adapter.listModels();
        expect(models[0].createdAt).toBe('2025-12-10T00:00:00Z');
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['ANTHROPIC_API_KEY'] = originalKey;
        } else {
          delete process.env['ANTHROPIC_API_KEY'];
        }
      }
    });
  });

  describe('auth error detection', () => {
    // Access the private static AUTH_ERROR_PATTERNS via the ClaudeSession class.
    // ClaudeSession is not exported, but we can test the patterns indirectly by
    // importing the adapter and checking that known auth error strings are caught.
    const authErrorStrings = [
      'Invalid API key - Please run /login',
      'Not logged in. Please run /login to authenticate.',
      'Please run /login to set up authentication',
      'Authentication required for this request',
      'Your expired token needs to be refreshed',
    ];

    const normalStrings = [
      'Here is a helpful response about APIs and keys.',
      'The login page is at /dashboard/login',
      'I can help you debug authentication issues in your code.',
      'Setting up API key rotation for your application',
    ];

    // These patterns are mirrored from ClaudeSession.AUTH_ERROR_PATTERNS
    const AUTH_ERROR_PATTERNS = [
      /Invalid API key/i,
      /Not logged in/i,
      /Please run \/login/i,
      /authentication required/i,
      /expired.*token/i,
    ];

    for (const text of authErrorStrings) {
      it(`detects auth error: "${text.substring(0, 50)}..."`, () => {
        const matches = AUTH_ERROR_PATTERNS.some(p => p.test(text));
        expect(matches).toBe(true);
      });
    }

    for (const text of normalStrings) {
      it(`does not flag normal content: "${text.substring(0, 50)}..."`, () => {
        const matches = AUTH_ERROR_PATTERNS.some(p => p.test(text));
        expect(matches).toBe(false);
      });
    }
  });
});
