/**
 * Unit tests for the OpenCode adapter.
 *
 * Uses mocked SDK to test adapter logic without requiring a running server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenCodeAdapter } from '../../../src/adapters/opencode.js';
import { createSilentLogger } from '../../../src/logger.js';

vi.mock('@opencode-ai/sdk', () => {
  return {
    createOpencode: vi.fn(),
    createOpencodeClient: vi.fn(),
  };
});

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    adapter = new OpenCodeAdapter({ logger: createSilentLogger() });
  });

  describe('provider', () => {
    it('is opencode', () => {
      expect(adapter.provider).toBe('opencode');
    });
  });

  describe('capabilities', () => {
    it('supports cancellation', () => {
      expect(adapter.capabilities.canCancel).toBe(true);
    });

    it('does NOT support blocking in pre-tool-use hooks', () => {
      expect(adapter.capabilities.canBlockInPreToolUse).toBe(false);
    });

    it('supports modifying tool input', () => {
      expect(adapter.capabilities.canModifyToolInput).toBe(true);
    });

    it('supports subagents via @mentions', () => {
      expect(adapter.capabilities.supportsSubagents).toBe(true);
    });

    it('supports streaming', () => {
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });

    it('supports resume', () => {
      expect(adapter.capabilities.supportsResume).toBe(true);
    });

    it('does NOT support session forking', () => {
      expect(adapter.capabilities.supportsFork).toBe(false);
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

    it('returns true when OPENAI_API_KEY is set', () => {
      const origAnthropic = process.env['ANTHROPIC_API_KEY'];
      const origOpenai = process.env['OPENAI_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'test-key';

      try {
        expect(adapter.isConfigured()).toBe(true);
      } finally {
        if (origAnthropic) process.env['ANTHROPIC_API_KEY'] = origAnthropic;
        if (origOpenai) {
          process.env['OPENAI_API_KEY'] = origOpenai;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });

    it('returns true when GOOGLE_API_KEY is set', () => {
      const origAnthropic = process.env['ANTHROPIC_API_KEY'];
      const origOpenai = process.env['OPENAI_API_KEY'];
      const origGoogle = process.env['GOOGLE_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['OPENAI_API_KEY'];
      process.env['GOOGLE_API_KEY'] = 'test-key';

      try {
        expect(adapter.isConfigured()).toBe(true);
      } finally {
        if (origAnthropic) process.env['ANTHROPIC_API_KEY'] = origAnthropic;
        if (origOpenai) process.env['OPENAI_API_KEY'] = origOpenai;
        if (origGoogle) {
          process.env['GOOGLE_API_KEY'] = origGoogle;
        } else {
          delete process.env['GOOGLE_API_KEY'];
        }
      }
    });
  });

  describe('createSession', () => {
    it('throws MISSING_CREDENTIALS when not configured', async () => {
      const origAnthropic = process.env['ANTHROPIC_API_KEY'];
      const origOpenai = process.env['OPENAI_API_KEY'];
      const origGoogle = process.env['GOOGLE_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['OPENAI_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];

      const unconfiguredAdapter = new OpenCodeAdapter({ logger: createSilentLogger() });

      try {
        if (!unconfiguredAdapter.isConfigured()) {
          await expect(
            unconfiguredAdapter.createSession({ provider: 'opencode' }),
          ).rejects.toThrow('credentials not configured');
        }
      } finally {
        if (origAnthropic) process.env['ANTHROPIC_API_KEY'] = origAnthropic;
        if (origOpenai) process.env['OPENAI_API_KEY'] = origOpenai;
        if (origGoogle) process.env['GOOGLE_API_KEY'] = origGoogle;
      }
    });

    it('throws on invalid config', async () => {
      await expect(
        adapter.createSession({ provider: 'claude' as any }),
      ).rejects.toThrow();
    });
  });

  describe('cleanup', () => {
    it('cleans up without error', async () => {
      await expect(adapter.cleanup()).resolves.toBeUndefined();
    });
  });
});
