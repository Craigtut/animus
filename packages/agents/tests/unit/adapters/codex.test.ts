/**
 * Unit tests for the Codex adapter.
 *
 * Uses mocked SDK to test adapter logic without requiring API keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from '../../../src/adapters/codex.js';
import { createSilentLogger } from '../../../src/logger.js';

vi.mock('@openai/codex-sdk', () => {
  return {
    Codex: vi.fn(),
  };
});

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter({ logger: createSilentLogger() });
  });

  describe('provider', () => {
    it('is codex', () => {
      expect(adapter.provider).toBe('codex');
    });
  });

  describe('capabilities', () => {
    it('does NOT support cancellation', () => {
      expect(adapter.capabilities.canCancel).toBe(false);
    });

    it('does NOT support blocking in pre-tool-use hooks', () => {
      expect(adapter.capabilities.canBlockInPreToolUse).toBe(false);
    });

    it('does NOT support subagents natively', () => {
      expect(adapter.capabilities.supportsSubagents).toBe(false);
    });

    it('does NOT support session forking', () => {
      expect(adapter.capabilities.supportsFork).toBe(false);
    });

    it('supports streaming', () => {
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });

    it('supports thinking via reasoning items', () => {
      expect(adapter.capabilities.supportsThinking).toBe(true);
    });

    it('supports resume', () => {
      expect(adapter.capabilities.supportsResume).toBe(true);
    });
  });

  describe('isConfigured', () => {
    it('returns true when OPENAI_API_KEY is set', () => {
      const original = process.env['OPENAI_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'test-key';

      try {
        expect(adapter.isConfigured()).toBe(true);
      } finally {
        if (original) {
          process.env['OPENAI_API_KEY'] = original;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });
  });

  describe('createSession', () => {
    it('throws MISSING_CREDENTIALS when not configured', async () => {
      const origKey = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      const unconfiguredAdapter = new CodexAdapter({ logger: createSilentLogger() });

      try {
        if (!unconfiguredAdapter.isConfigured()) {
          await expect(
            unconfiguredAdapter.createSession({ provider: 'codex' }),
          ).rejects.toThrow('credentials not configured');
        }
      } finally {
        if (origKey) process.env['OPENAI_API_KEY'] = origKey;
      }
    });

    it('throws on invalid config', async () => {
      await expect(
        adapter.createSession({ provider: 'claude' as any }),
      ).rejects.toThrow();
    });
  });

  describe('resumeSession', () => {
    it('throws on provider mismatch', async () => {
      await expect(adapter.resumeSession('claude:some-id')).rejects.toThrow();
    });
  });
});
