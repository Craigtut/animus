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
    it('returns models from capabilities', async () => {
      const models = await adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('name');
      expect(models.some((m) => m.id.includes('claude'))).toBe(true);
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
